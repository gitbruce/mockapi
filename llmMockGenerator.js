const { ChatOllama } = require("@langchain/community/chat_models/ollama");
const { fakerZH_CN } = require('@faker-js/faker');
const RandExp = require('randexp');

const faker = fakerZH_CN;

const chat = new ChatOllama({
  baseUrl: "http://localhost:11434",
  model: "qwen2.5:7b"
});

async function generateMock(schema, context = {}) {
  if (!schema || typeof schema !== 'object') return null;
  const result = {};
  const props = schema.properties || {};

  // 预先生成所有 faker 字段，供 LLM prompt 替换使用
  const fakerCache = {};

  for (const [key, propSchema] of Object.entries(props)) {
    const fakerValue = await generateField(key, propSchema, context, result);
    result[key] = fakerValue;
    fakerCache[key] = fakerValue;
  }

  // 补充处理 LLM 字段：重新生成包含 prompt 的字段
  for (const [key, propSchema] of Object.entries(props)) {
    if (propSchema['x-llm']) {
      result[key] = await generateLLMField(key, propSchema, fakerCache);
    }
  }

  return result;
}

async function generateField(fieldName, schema, context, nameValue = '') {
  // 1. LLM prompt 优先
  if (schema?.['x-llm']) {
    return await generateLLMField(schema['x-llm-prompt'], nameValue);
  }

  // 2. Faker
  if (schema?.['x-faker']) {
    return generateByFakerTag(schema);
  }

  // 3. 枚举
  if (schema?.enum) {
    return faker.helpers.arrayElement(schema.enum);
  }

  // 4. 正则
  if (schema?.pattern) {
    return generateByPattern(schema.pattern);
  }

  // ✅ 5. 数组类型（关键补充）
  if (schema?.type === 'array' && schema?.items) {
    const count = faker.number.int({ min: 1, max: 3 });
    const items = [];
    for (let i = 0; i < count; i++) {
      items.push(await generateMock(schema.items, context));
    }
    return items;
  }

  // 6. 原始类型 fallback
  if (schema?.type === 'string') {
    if (schema.format === 'email') return faker.internet.email();
    if (schema.format === 'date') {
      const date = faker.date.birthdate({ mode: 'year', min: 18, max: 60 });
      return date.toISOString().split('T')[0];
    }
    return faker.lorem.words();
  }

  if (schema?.type === 'number') return faker.number.float({ min: 1, max: 9999, precision: 0.01 });
  if (schema?.type === 'integer') return faker.number.int(1000);
  if (schema?.type === 'boolean') return faker.datatype.boolean();

  return null;
}


function generateByFakerTag(schema) {
  const fakerMethod = schema['x-faker'];
  const fakerOptions = schema['x-faker-options'] || {};

  if (fakerMethod === 'helpers.arrayElement') {
    const values = fakerOptions.values || [];
    return faker.helpers.arrayElement(values);
  }

  const parts = fakerMethod.split('.');
  let func = faker;

  for (const part of parts) {
    func = func?.[part];
    if (!func) break;
  }

  return typeof func === 'function' ? func() : `faker方法错误: ${fakerMethod}`;
}

function generateByPattern(pattern) {
  try {
    const reg = new RegExp(pattern.replace(/\\\\/g, '\\'));
    return new RandExp(reg).gen();
  } catch (e) {
    return '正则生成失败';
  }
}

async function generateLLMField(fieldName, schema, contextObj = {}) {
  const rawPrompt = schema['x-llm-prompt'];
  let prompt = rawPrompt || `请生成一个字段 ${fieldName} 的内容，仅返回结果本身，不要解释。`;

  for (const key in contextObj) {
    const val = contextObj[key];
    prompt = prompt.replaceAll(`{{${key}}}`, val);
  }

  const response = await chat.invoke(prompt);
  let content = response.content.trim();

  if (content.includes('\n')) {
    const lines = content.split('\n').filter(line => line.trim());
    content = lines[lines.length - 1]; // 最后一行最可能是最终内容
  }

  return content;
}

module.exports = { generateMock };
