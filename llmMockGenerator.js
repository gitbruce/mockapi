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

  for (const [key, propSchema] of Object.entries(props)) {
    result[key] = await generateField(key, propSchema, context, result);
  }

  return result;
}

async function generateField(fieldName, propSchema, context, resultSoFar) {
  if (shouldUseLLM(propSchema)) {
    return await generateLLMField(fieldName, propSchema, resultSoFar);
  }

  if (propSchema.enum) {
    return faker.helpers.arrayElement(propSchema.enum);
  }

  if (propSchema['x-faker']) {
    return generateByFakerTag(propSchema);
  }

  if (propSchema.pattern) {
    return generateByPattern(propSchema.pattern);
  }

  if (propSchema.format) {
    return generateByFormat(propSchema.format);
  }

  return generateByType(fieldName, propSchema);
}

function shouldUseLLM(propSchema) {
  return propSchema?.['x-llm'] === true;
}

async function generateLLMField(fieldName, propSchema, resultSoFar) {
  let template = propSchema['x-llm-prompt'] || `请生成字段 "${fieldName}" 的内容。`;
  const prompt = template.replace(/\{\{(\w+)\}\}/g, (_, key) => resultSoFar?.[key] || '');

  try {
    const response = await chat.invoke(prompt);
    const content = response.content.trim();
    return content.split('\n').find(line => line.trim()) || content;
  } catch (e) {
    return 'LLM生成失败';
  }
}

function generateByFakerTag(propSchema) {
  const methodPath = propSchema['x-faker'];
  const fakerOptions = propSchema['x-faker-options'] || {};

  if (methodPath === 'helpers.arrayElement') {
    return faker.helpers.arrayElement(fakerOptions.values || []);
  }

  const parts = methodPath.split('.');
  let func = faker;
  for (const part of parts) {
    func = func?.[part];
    if (!func) return '未知faker方法';
  }

  return typeof func === 'function' ? func() : '无效faker方法';
}

function generateByPattern(pattern) {
  try {
    const cleaned = pattern.replace(/\\\\/g, '\\');
    return new RandExp(new RegExp(cleaned)).gen();
  } catch (e) {
    return '正则生成失败';
  }
}

function generateByFormat(format) {
  switch (format) {
    case 'email':
      return faker.internet.email();
    case 'date':
      return faker.date.birthdate().toISOString().split('T')[0];
    case 'uri':
      return faker.internet.url();
    case 'uuid':
      return faker.string.uuid();
    default:
      return '格式不支持';
  }
}

function generateByType(fieldName, propSchema) {
  if (fieldName === 'id') return faker.number.int(1000);

  switch (propSchema.type) {
    case 'string':
      return faker.lorem.words(2);
    case 'integer':
      return faker.number.int(1000);
    case 'number':
      return faker.number.float({ min: 0, max: 100 });
    case 'boolean':
      return faker.datatype.boolean();
    default:
      return null;
  }
}

module.exports = { generateMock };
