const fs = require('fs');
const path = require('path');
const YAML = require('yamljs');

function loadAllOpenAPIDefinitions(dir) {
    const result = {
        openapi: '3.0.3',
        info: { title: 'LLM Mock API', version: '1.0.0' },
        paths: {}
    };

    for (const file of fs.readdirSync(dir)) {
        if (file.endsWith('.yaml')) {
            const doc = YAML.load(path.join(dir, file));
            Object.assign(result.paths, doc.paths || {});
        }
    }

    return result;
}

module.exports = { loadAllOpenAPIDefinitions };
