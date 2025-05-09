// llmMockGenerator.js（增强版）
const { ChatOllama } = require("@langchain/community/chat_models/ollama");
const { faker } = require('@faker-js/faker');
const RandExp = require('randexp');
const {LRUCache} = require('lru-cache');

const cache = new LRUCache({ max: 1000, ttl: 1000 * 60 * 10 });

const chatClients = {}; // 多模型缓存
function getChat(model = "qwen2.5:3b") {
  if (!chatClients[model]) {
    chatClients[model] = new ChatOllama({ baseUrl: "http://localhost:11434", model });
  }
  return chatClients[model];
}

function setLocale(langHeader = '') {
  const lang = langHeader?.toLowerCase();
  if (lang.includes('zh')) faker.locale = 'zh_CN';
  else if (lang.includes('en')) faker.locale = 'en';
  else faker.locale = 'zh_CN';
}

function applySeed(seed) {
  if (seed) faker.seed(Number(seed));
}

async function generateMock(schema, context = {}, seed = null) {
  if (!schema || typeof schema !== 'object') return null;
  const props = schema.properties || {};
  const result = {};

  const headers = context?.request?.headers || {};
  const acceptLang = headers['accept-language'] || headers['x-locale'] || 'zh-CN';
  setLocale(acceptLang);
  applySeed(seed);

  for (const [key, propSchema] of Object.entries(props)) {
    result[key] = await generateField(key, propSchema, context, result);
  }
  return result;
}

async function generateField(fieldName, schema, context, parentData) {
  if (schema?.type === 'object' && schema.properties) {
    return await generateMock(schema, context);
  }

  if (schema?.type === 'array' && schema.items) {
    const count = 2;
    const items = await Promise.all(
      Array(count).fill(null).map(() => generateField(fieldName, schema.items, context, parentData))
    );
    return items;
  }

  if (schema?.enum) return faker.helpers.arrayElement(schema.enum);
  if (schema?.pattern) return new RandExp(new RegExp(schema.pattern)).gen();
  if (schema?.format) return generateFormat(schema.format);
  if (schema?.['x-faker']) return runFaker(schema['x-faker']);
  if (schema?.['x-llm']) return await runLLM(schema, fieldName, parentData);

  return generateType(schema);
}

function runFaker(tag) {
  const parts = tag.split('.');
  let fn = faker;
  for (const p of parts) fn = fn?.[p];
  return typeof fn === 'function' ? fn() : fn;
}

function generateFormat(format) {
  switch (format) {
    case 'email': return faker.internet.email();
    case 'date': return faker.date.birthdate().toISOString().split('T')[0];
    default: return faker.lorem.word();
  }
}

function generateType(schema) {
  if (schema.type === 'string') return faker.lorem.words();
  if (schema.type === 'number') return faker.number.float({ min: 0, max: 100 });
  if (schema.type === 'integer') return faker.number.int(1000);
  if (schema.type === 'boolean') return faker.datatype.boolean();
  return null;
}

async function runLLM(schema, fieldName, data = {}) {
  const promptTpl = schema['x-llm-prompt'] || `请生成 ${fieldName} 的内容`;
  const model = schema['x-llm-model'] || 'qwen2.5:7b';

  const prompt = promptTpl.replace(/\{\{(.*?)\}\}/g, (_, key) => data[key] || '');
  const cacheKey = `${model}:${prompt}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const chat = getChat(model);
  const res = await chat.invoke(prompt);
  const output = (res.content || '').split('\n').find(Boolean)?.trim() || '内容缺失';

  cache.set(cacheKey, output);
  return output;
}

module.exports = { generateMock };
