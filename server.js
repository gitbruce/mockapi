const express = require('express');
const OpenAPIBackend = require('openapi-backend').default;
const YAML = require('yamljs');
const chokidar = require('chokidar');
const { generateMock } = require('./llmMockGenerator');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const bodyParser = require('body-parser');

const app = express();
const port = 5000;

app.use(bodyParser.json());

let apiDoc = null;
let api = null;

function createApi() {
    apiDoc = YAML.load(path.join(__dirname, './openapi/v1/api.yaml'));

    const newApi = new OpenAPIBackend({
        definition: apiDoc,
        quick: true,
        validate: true
    });
    newApi.init();

    // 关键：一个统一的 handler
    async function universalHandler(c, req, res) {
        const responseSchema = c.operation?.responses?.['200']?.content?.['application/json']?.schema;
        if (responseSchema) {
            const mockData = await generateMock(responseSchema, c);
            res.status(200).json(mockData);
        } else {
            res.status(501).json({ error: 'No 200 response schema found' });
        }
    }

    // 动态注册所有 operationId
    const operations = Object.entries(newApi.definition.paths)
        .flatMap(([pathName, methods]) =>
            Object.entries(methods).map(([method, op]) => op?.operationId).filter(Boolean)
        );

    operations.forEach(opId => {
        newApi.registerHandler(opId, universalHandler);
    });

    // 如果有未注册的，fallback
    newApi.registerHandler('notFound', (c, req, res) => {
        res.status(404).json({ error: 'Not Found' });
    });

    api = newApi;
}

createApi();

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(apiDoc));

app.use(async (req, res, next) => {
    const request = {
        method: req.method,
        path: req.path,
        body: req.body,
        query: req.query,
        headers: req.headers,
    };
    try {
        const response = await api.handleRequest(request, req, res);
        if (!response) return next();
    } catch (err) {
        console.error('处理请求时出错:', err);
        res.status(500).json({ error: 'Internal Server Error', detail: err.message });
    }
});

// 热更新 openapi.yaml
chokidar.watch(path.join(__dirname, './openapi/v1/api.yaml')).on('change', () => {
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
