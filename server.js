const express = require('express');
const OpenAPIBackend = require('openapi-backend').default;
const { loadAllOpenAPIDefinitions } = require('./loader'); // 新增，支持多 YAML 合并
const { generateMock } = require('./llmMockGenerator');
const path = require('path');
const chokidar = require('chokidar');
const swaggerUi = require('swagger-ui-express');
const bodyParser = require('body-parser');

const app = express();
const port = 5000;

app.use(bodyParser.json());

let apiDoc = null;
let api = null;

function createApi() {
    const yamlDir = path.join(__dirname, './openapi/v1');
    apiDoc = loadAllOpenAPIDefinitions(yamlDir);

    const newApi = new OpenAPIBackend({
        definition: apiDoc,
        quick: true,
        validate: true
    });
    newApi.init();

    async function universalHandler(c, req, res) {
        const schema = c.operation?.responses?.['200']?.content?.['application/json']?.schema;
        const mockData = await generateMock(schema, c);
        res.status(200).json(mockData);
    }

    // 自动注册所有 operationId
    for (const methods of Object.values(apiDoc.paths)) {
        for (const op of Object.values(methods)) {
            if (op.operationId) {
                newApi.registerHandler(op.operationId, universalHandler);
            }
        }
    }

    newApi.registerHandler('notFound', (c, req, res) => {
        res.status(404).json({ error: 'Not Found' });
    });

    api = newApi;
}

createApi();

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(apiDoc));

app.use(async (req, res, next) => {
    try {
        const request = {
            method: req.method,
            path: req.path,
            body: req.body,
            query: req.query,
            headers: req.headers
        };
        const result = await api.handleRequest(request, req, res);
        if (!result) return next();
    } catch (err) {
        console.error('处理请求时出错:', err);
        res.status(500).json({ error: 'Internal Server Error', detail: err.message });
    }
});

// 热更新所有 yaml 文档
const watcher = chokidar.watch(path.join(__dirname, './openapi/v1'));
watcher.on('change', () => {
    console.log('♻️ 检测到 OpenAPI 文档变更，重新加载...');
    try {
        createApi();
        console.log('✅ OpenAPI文档重新加载完成');
    } catch (err) {
        console.error('❌ OpenAPI文档重新加载失败:', err);
    }
});

app.listen(port, () => {
    console.log(`🚀 LLM Mock Server running at http://localhost:${port}/api-docs`);
});
