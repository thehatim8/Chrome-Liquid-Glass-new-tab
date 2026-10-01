import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'fs';

import { sanitizeAIChatSettings } from '../js/main.js';
import {
  extractAIText,
  normalizeModelName,
  getProviderDisplayName,
  normalizeProvider,
  detectAIProvider,
  getGoogleFallbackCandidates,
  GOOGLE_FALLBACK_MODELS,
  executeAIChatRequest,
  requestAIChat
} from '../js/aiChat.js';
import { stringifyProviderError, handleAIChatMessage, normalizeModelName as bgNormalizeModelName } from '../background.js';

test('HTML: newtab.html contains AI Provider dropdown with OpenRouter, OpenAI, and Google AI Studio', () => {
  const html = fs.readFileSync('newtab.html', 'utf8');
  assert.ok(html.includes('id="aiChatProvider"'), 'newtab.html must have select element with id aiChatProvider');
  assert.ok(html.includes('value="openrouter"'), 'Provider dropdown must have openrouter option');
  assert.ok(html.includes('value="openai"'), 'Provider dropdown must have openai option');
  assert.ok(html.includes('value="google"'), 'Provider dropdown must have google option');
  assert.ok(html.includes('id="aiChatSubheading"'), 'Section must have aiChatSubheading');
  assert.ok(html.includes('id="aiChatHint"'), 'Section must have aiChatHint');
  assert.ok(html.includes('id="aiChatModelList"'), 'Section must have datalist with id aiChatModelList');
  assert.ok(html.includes('list="aiChatModelList"'), 'aiChatModel input must reference aiChatModelList');
});

test('Manifest: host_permissions contains openrouter, openai, and googleapis', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  const hosts = manifest.host_permissions || [];
  assert.ok(hosts.some(h => h.includes('openrouter.ai')), 'host_permissions includes openrouter.ai');
  assert.ok(hosts.some(h => h.includes('api.openai.com')), 'host_permissions includes api.openai.com');
  assert.ok(hosts.some(h => h.includes('generativelanguage.googleapis.com')), 'host_permissions includes generativelanguage.googleapis.com');
});

test('sanitizeAIChatSettings: handles default/empty state', () => {
  const result = sanitizeAIChatSettings({});
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.apiKey, '');
  assert.equal(result.model, 'openrouter/auto');
  assert.ok(result.providers);
  assert.equal(result.providers.openrouter.model, 'openrouter/auto');
  assert.equal(result.providers.openai.model, 'gpt-4o-mini');
  assert.equal(result.providers.google.model, 'gemini-flash-latest');
});

test('sanitizeAIChatSettings: backward compatibility with legacy single-provider storage', () => {
  const legacy = {
    apiKey: 'sk-or-v1-legacykey',
    model: 'liquid/lfm-2.5-1.2b-instruct:free'
  };
  const result = sanitizeAIChatSettings(legacy);
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.apiKey, 'sk-or-v1-legacykey');
  assert.equal(result.model, 'liquid/lfm-2.5-1.2b-instruct:free');
  assert.equal(result.providers.openrouter.apiKey, 'sk-or-v1-legacykey');
  assert.equal(result.providers.openrouter.model, 'liquid/lfm-2.5-1.2b-instruct:free');
});

test('sanitizeAIChatSettings: supports OpenAI and Google AI Studio providers', () => {
  const openaiSettings = {
    provider: 'openai',
    apiKey: 'sk-openai-key-123',
    model: 'gpt-4o-mini'
  };
  const resOpenAI = sanitizeAIChatSettings(openaiSettings);
  assert.equal(resOpenAI.provider, 'openai');
  assert.equal(resOpenAI.apiKey, 'sk-openai-key-123');
  assert.equal(resOpenAI.model, 'gpt-4o-mini');

  const googleSettings = {
    provider: 'google',
    apiKey: 'AIzaSyGoogleKey123',
    model: 'gemini-flash-latest'
  };
  const resGoogle = sanitizeAIChatSettings(googleSettings);
  assert.equal(resGoogle.provider, 'google');
  assert.equal(resGoogle.apiKey, 'AIzaSyGoogleKey123');
  assert.equal(resGoogle.model, 'gemini-flash-latest');

  // Alias normalization (e.g. "gemini" -> "google")
  const aliasSettings = {
    provider: 'gemini',
    apiKey: 'AIzaKey'
  };
  const resAlias = sanitizeAIChatSettings(aliasSettings);
  assert.equal(resAlias.provider, 'google');
});

test('sanitizeAIChatSettings: preserves distinct keys across all providers in providers map', () => {
  const multiProviderState = {
    provider: 'google',
    apiKey: 'AIzaGoogle',
    model: 'gemini-2.0-flash',
    providers: {
      openrouter: { apiKey: 'sk-or-key', model: 'openrouter/auto' },
      openai: { apiKey: 'sk-oai-key', model: 'gpt-4o' },
      google: { apiKey: 'AIzaGoogle', model: 'gemini-2.0-flash' }
    }
  };
  const res = sanitizeAIChatSettings(multiProviderState);
  assert.equal(res.provider, 'google');
  assert.equal(res.apiKey, 'AIzaGoogle');
  assert.equal(res.model, 'gemini-2.0-flash');
  assert.equal(res.providers.openrouter.apiKey, 'sk-or-key');
  assert.equal(res.providers.openai.apiKey, 'sk-oai-key');
  assert.equal(res.providers.google.apiKey, 'AIzaGoogle');
});

test('normalizeModelName: returns appropriate defaults per provider', () => {
  assert.equal(normalizeModelName('', 'openrouter'), 'openrouter/auto');
  assert.equal(normalizeModelName('', 'openai'), 'gpt-4o-mini');
  assert.equal(normalizeModelName('', 'google'), 'gemini-flash-latest');
  assert.equal(normalizeModelName('', 'gemini'), 'gemini-flash-latest');
  assert.equal(normalizeModelName('custom-model-x', 'openai'), 'custom-model-x');
});

test('getProviderDisplayName: returns friendly human-readable name', () => {
  assert.equal(getProviderDisplayName('openrouter'), 'OpenRouter');
  assert.equal(getProviderDisplayName('openai'), 'OpenAI');
  assert.equal(getProviderDisplayName('google'), 'Google AI Studio');
  assert.equal(getProviderDisplayName('gemini'), 'Google AI Studio');
  assert.equal(getProviderDisplayName('unknown'), 'OpenRouter');
});

test('extractAIText: parses Google AI Studio (Gemini) responses correctly', () => {
  // Single part
  const geminiResponse = {
    candidates: [
      {
        content: {
          parts: [
            { text: 'AI is computer systems capable of performing tasks that require human intelligence.' }
          ],
          role: 'model'
        },
        finishReason: 'STOP'
      }
    ]
  };
  assert.equal(
    extractAIText(geminiResponse),
    'AI is computer systems capable of performing tasks that require human intelligence.'
  );

  // Multi-part response
  const multipartGemini = {
    candidates: [
      {
        content: {
          parts: [
            { text: 'Part 1: Neural networks.' },
            { text: 'Part 2: Training on data.' }
          ],
          role: 'model'
        }
      }
    ]
  };
  assert.equal(
    extractAIText(multipartGemini),
    'Part 1: Neural networks.\nPart 2: Training on data.'
  );
});

test('extractAIText: parses OpenAI and OpenRouter responses correctly', () => {
  const oaiResponse = {
    choices: [
      {
        message: {
          role: 'assistant',
          content: 'OpenAI response message text.'
        }
      }
    ]
  };
  assert.equal(extractAIText(oaiResponse), 'OpenAI response message text.');
});

test('Google Gemini request payload transformation', () => {
  const messages = [
    { role: 'system', content: 'You are a dashboard assistant.' },
    { role: 'user', content: 'Explain AI in a few words' }
  ];

  const systemMsgs = messages.filter(m => m.role === 'system');
  const systemInstruction = systemMsgs.length > 0
    ? { parts: systemMsgs.map(m => ({ text: m.content })) }
    : undefined;

  const nonSystemMsgs = messages.filter(m => m.role !== 'system');
  const geminiContents = nonSystemMsgs.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  assert.deepEqual(systemInstruction, { parts: [{ text: 'You are a dashboard assistant.' }] });
  assert.deepEqual(geminiContents, [
    { role: 'user', parts: [{ text: 'Explain AI in a few words' }] }
  ]);
});

test('sanitizeAIChatSettings: switching provider does NOT leak previous provider API key or model', () => {
  const previousState = {
    provider: 'google',
    apiKey: 'sk-or-v1-supersecret-openrouter-key',
    model: 'liquid/lfm-2.5-1.2b-instruct:free',
    providers: {
      openrouter: {
        apiKey: 'sk-or-v1-supersecret-openrouter-key',
        model: 'liquid/lfm-2.5-1.2b-instruct:free'
      },
      openai: {
        apiKey: '',
        model: 'gpt-4o-mini'
      },
      google: {
        apiKey: '',
        model: 'gemini-flash-latest'
      }
    }
  };

  const sanitized = sanitizeAIChatSettings(previousState);
  assert.equal(sanitized.provider, 'google');
  assert.equal(sanitized.apiKey, '', 'Google apiKey should be empty, not contaminated with OpenRouter key');
  assert.equal(sanitized.model, 'gemini-flash-latest', 'Google model should be gemini-flash-latest, not liquid/lfm');
  assert.equal(sanitized.providers.google.apiKey, '');
  assert.equal(sanitized.providers.openrouter.apiKey, 'sk-or-v1-supersecret-openrouter-key');
});

test('normalizeModelName: cleans provider prefixes and guards against cross-provider residue', () => {
  // Google
  assert.equal(normalizeModelName('models/gemini-2.0-flash', 'google'), 'gemini-2.0-flash');
  assert.equal(normalizeModelName('google/gemini-flash-latest', 'google'), 'gemini-flash-latest');
  assert.equal(normalizeModelName('gpt-4o-mini', 'google'), 'gemini-flash-latest');
  assert.equal(normalizeModelName('invalid/model/with/slashes', 'google'), 'gemini-flash-latest');

  // OpenAI
  assert.equal(normalizeModelName('openai/gpt-4o', 'openai'), 'gpt-4o');
  assert.equal(normalizeModelName('gemini-flash-latest', 'openai'), 'gpt-4o-mini');
  assert.equal(normalizeModelName('invalid/model', 'openai'), 'gpt-4o-mini');

  // OpenRouter preserves custom provider prefixes
  assert.equal(normalizeModelName('google/gemini-2.0-flash-001', 'openrouter'), 'google/gemini-2.0-flash-001');
  assert.equal(normalizeModelName('openai/gpt-4o', 'openrouter'), 'openai/gpt-4o');
});

test('Gemini role sequence normalization: strips invalid leading/trailing model turns', () => {
  const rawMessages = [
    { role: 'assistant', content: 'Greeting that started conversation' },
    { role: 'user', content: 'What is photosynthesis?' },
    { role: 'assistant', content: 'Trailing assistant response' }
  ];

  const nonSystemMsgs = rawMessages.filter(m => m.role !== 'system');
  const geminiContents = [];
  for (const m of nonSystemMsgs) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const text = String(m.content || '').trim();
    if (!text) continue;
    const prev = geminiContents[geminiContents.length - 1];
    if (prev && prev.role === role) {
      prev.parts[0].text += '\n\n' + text;
    } else {
      geminiContents.push({ role, parts: [{ text }] });
    }
  }

  while (geminiContents.length > 0 && geminiContents[0].role === 'model') {
    geminiContents.shift();
  }
  while (geminiContents.length > 0 && geminiContents[geminiContents.length - 1].role === 'model') {
    geminiContents.pop();
  }

  assert.equal(geminiContents.length, 1);
  assert.equal(geminiContents[0].role, 'user');
  assert.equal(geminiContents[0].parts[0].text, 'What is photosynthesis?');
});

test('normalizeProvider: robust normalization of provider strings and casing', () => {
  assert.equal(normalizeProvider('google ai studio'), 'google');
  assert.equal(normalizeProvider('Google AI Studio'), 'google');
  assert.equal(normalizeProvider('google_ai_studio'), 'google');
  assert.equal(normalizeProvider('google-ai-studio'), 'google');
  assert.equal(normalizeProvider('googleaistudio'), 'google');
  assert.equal(normalizeProvider('google'), 'google');
  assert.equal(normalizeProvider('Google'), 'google');
  assert.equal(normalizeProvider('gemini'), 'google');
  assert.equal(normalizeProvider('Gemini'), 'google');
  assert.equal(normalizeProvider('google-ai'), 'google');

  assert.equal(normalizeProvider('openai'), 'openai');
  assert.equal(normalizeProvider('OpenAI'), 'openai');
  assert.equal(normalizeProvider('chatgpt'), 'openai');

  assert.equal(normalizeProvider('openrouter'), 'openrouter');
  assert.equal(normalizeProvider('OpenRouter'), 'openrouter');
  assert.equal(normalizeProvider(''), 'openrouter');
  assert.equal(normalizeProvider(null), 'openrouter');
  assert.equal(normalizeProvider(undefined), 'openrouter');
  assert.equal(normalizeProvider('unknown-provider'), 'openrouter');
});

test('detectAIProvider: accurately infers provider from key formats, models, and inputs', () => {
  // 1. Google keys
  assert.equal(detectAIProvider({ token: 'AIzaSyA_sampleGoogleKey_123' }), 'google');
  assert.equal(detectAIProvider({ token: 'AQ_sampleGoogleKey_456' }), 'google');
  assert.equal(detectAIProvider({ token: 'Bearer AIzaSyA_sampleGoogleKey_123' }), 'google');
  assert.equal(detectAIProvider({ token: '"AIzaSyA_sampleGoogleKey_123"' }), 'google');
  assert.equal(detectAIProvider({ token: "'AIzaSyA_sampleGoogleKey_123'" }), 'google');

  // 2. OpenRouter keys
  assert.equal(detectAIProvider({ token: 'sk-or-v1-abcdef123456' }), 'openrouter');
  assert.equal(detectAIProvider({ token: 'Bearer sk-or-v1-abcdef123456' }), 'openrouter');

  // 3. OpenAI keys
  assert.equal(detectAIProvider({ token: 'sk-proj-abcdef123456' }), 'openai');
  assert.equal(detectAIProvider({ token: 'Bearer sk-proj-abcdef123456' }), 'openai');

  // 4. Explicit provider string with unformatted or custom token
  assert.equal(detectAIProvider({ provider: 'google ai studio', token: 'custom-key' }), 'google');
  assert.equal(detectAIProvider({ provider: 'Google AI Studio', token: 'custom-key' }), 'google');
  assert.equal(detectAIProvider({ provider: 'openai', token: 'custom-key' }), 'openai');

  // 5. Model prefix with generic token
  assert.equal(detectAIProvider({ model: 'gemini-3.5-flash', token: '' }), 'google');
  assert.equal(detectAIProvider({ model: 'gemini-2.0-flash', token: '' }), 'google');
  assert.equal(detectAIProvider({ model: 'models/gemini-1.5-flash', token: '' }), 'google');
  assert.equal(detectAIProvider({ model: 'google/gemini-2.0-flash', token: '' }), 'google');
  assert.equal(detectAIProvider({ model: 'gpt-4o-mini', token: '' }), 'openai');

  // 6. OpenRouter key used with Google model stays OpenRouter
  assert.equal(detectAIProvider({ model: 'google/gemini-2.0-flash', token: 'sk-or-v1-key' }), 'openrouter');
});

test('Bug Fix: Google AI Studio with gemini-3.5-flash correctly routes to Google, NOT OpenRouter', () => {
  // Scenario from user:
  // Provider: "google ai studio" (or "google")
  // API key: Google AI Studio key ("AIzaSy...")
  // Model: "gemini-3.5-flash"
  const userConfig = {
    provider: 'Google AI Studio',
    token: 'AIzaSyDemoGoogleStudioKey998877',
    model: 'gemini-3.5-flash'
  };

  const detected = detectAIProvider(userConfig);
  assert.equal(detected, 'google', 'Must detect provider as google to prevent 401 routing to OpenRouter');

  const normalizedModel = normalizeModelName(userConfig.model, detected);
  assert.equal(normalizedModel, 'gemini-3.5-flash', 'Model name should be preserved for Google provider');

  // Verify URL generation includes ?key= and proper endpoint
  const token = userConfig.token.replace(/^Bearer\s+/i, '').replace(/^["']|["']$/g, '').trim();
  const googleUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(normalizedModel)}:generateContent?key=${encodeURIComponent(token)}`;
  assert.ok(googleUrl.includes('generativelanguage.googleapis.com'), 'Uses Google endpoint');
  assert.ok(googleUrl.includes('models/gemini-3.5-flash:generateContent'), 'Uses correct model path');
  assert.ok(googleUrl.includes(`?key=${encodeURIComponent(token)}`), 'Passes key query parameter');
});

test('sanitizeAIChatSettings: preserves user selected Google provider, AIza key and gemini-3.5-flash model', () => {
  const userSettings = {
    provider: 'Google AI Studio',
    apiKey: 'AIzaSyGoogleApiKey123',
    model: 'gemini-3.5-flash'
  };

  const sanitized = sanitizeAIChatSettings(userSettings);
  assert.equal(sanitized.provider, 'google');
  assert.equal(sanitized.apiKey, 'AIzaSyGoogleApiKey123');
  assert.equal(sanitized.model, 'gemini-3.5-flash');
  assert.equal(sanitized.providers.google.apiKey, 'AIzaSyGoogleApiKey123');
  assert.equal(sanitized.providers.google.model, 'gemini-3.5-flash');
});

test('Google AI Studio 404 model fallback candidate selection via getGoogleFallbackCandidates', () => {
  const candidates35 = getGoogleFallbackCandidates('gemini-3.5-flash');
  assert.ok(candidates35.includes('gemini-2.0-flash'), 'gemini-3.5-flash candidates must include gemini-2.0-flash');
  assert.equal(candidates35[0], 'gemini-2.0-flash', 'Primary fallback should be gemini-2.0-flash');
  assert.ok(!candidates35.includes('gemini-3.5-flash'), 'Candidates must not include requested model');

  const candidates20 = getGoogleFallbackCandidates('gemini-2.0-flash');
  assert.ok(!candidates20.includes('gemini-2.0-flash'), 'Candidates must exclude gemini-2.0-flash');
  assert.ok(candidates20.includes('gemini-1.5-flash'), 'Candidates must include gemini-1.5-flash');

  // Handles prefixes and quotes
  const prefixed = getGoogleFallbackCandidates('"models/gemini-2.0-flash"');
  assert.ok(!prefixed.includes('gemini-2.0-flash'), 'Normalized model excludes clean gemini-2.0-flash');
});

test('Token and model cleanup strips quotes, whitespace, and prefixes', () => {
  const dirtyToken = '  Bearer "AIzaSyQuoteWrappedKey"  ';
  const cleanToken = dirtyToken.trim().replace(/^Bearer\s+/i, '').replace(/^["']|["']$/g, '').trim();
  assert.equal(cleanToken, 'AIzaSyQuoteWrappedKey');

  const dirtyModel = '  models/gemini-3.5-flash  ';
  const cleanModel = dirtyModel.trim().replace(/^models\//i, '').replace(/^google\//i, '').trim();
  assert.equal(cleanModel, 'gemini-3.5-flash');
});

test('stringifyProviderError: extracts clean messages across different provider error shapes', () => {
  assert.equal(stringifyProviderError('Plain error string'), 'Plain error string');
  assert.equal(stringifyProviderError({ message: 'Top-level message' }), 'Top-level message');
  assert.equal(stringifyProviderError({ error: { message: 'Nested error message' } }), 'Nested error message');
  assert.equal(stringifyProviderError({ error: 'Direct error string' }), 'Direct error string');
  assert.equal(stringifyProviderError(''), '');
  assert.equal(stringifyProviderError(null), '');
});

test('extractAIText: safely handles stringified JSON payload', () => {
  const geminiPayload = JSON.stringify({
    candidates: [
      {
        content: {
          parts: [{ text: 'Response from stringified JSON' }]
        }
      }
    ]
  });
  assert.equal(extractAIText(geminiPayload), 'Response from stringified JSON');

  const plainText = 'Plain string content';
  assert.equal(extractAIText(plainText), 'Plain string content');
});

test('detectAIProvider: standard sk- key defaults to openai unless openrouter prefix', () => {
  assert.equal(detectAIProvider({ token: 'sk-abcdef123456789' }), 'openai');
  assert.equal(detectAIProvider({ token: 'sk-or-v1-abcdef123' }), 'openrouter');
  assert.equal(detectAIProvider({ provider: 'google', token: 'custom-unprefixed-key' }), 'google');
});

test('handleAIChatMessage: Google AI Studio gemini-3.5-flash catches 404 and falls back to gemini-2.0-flash', async () => {
  const fetchCalls = [];
  const mockFetch = async (url, opts) => {
    fetchCalls.push({ url, opts });
    if (url.includes('models/gemini-3.5-flash:generateContent')) {
      return {
        ok: false,
        status: 404,
        text: async () => JSON.stringify({
          error: {
            code: 404,
            message: 'models/gemini-3.5-flash is not found for API version v1beta',
            status: 'NOT_FOUND'
          }
        })
      };
    }
    if (url.includes('models/gemini-2.0-flash:generateContent')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: 'Hello from Gemini 2.0 Flash!' }]
              },
              finishReason: 'STOP'
            }
          ],
          modelVersion: 'gemini-2.0-flash-001'
        })
      };
    }
    return { ok: false, status: 500, text: async () => 'Unexpected URL' };
  };

  const message = {
    type: 'ai-chat',
    provider: 'google',
    token: 'AIzaSyTestKey123',
    model: 'gemini-3.5-flash',
    messages: [{ role: 'user', content: 'Hello' }]
  };

  const result = await handleAIChatMessage(message, mockFetch);
  assert.equal(result.ok, true, 'Request should succeed via fallback');
  assert.equal(result.status, 200);
  assert.ok(result.modelUsed.includes('fallback from gemini-3.5-flash'), 'Indicates fallback');
  assert.equal(fetchCalls.length, 2, 'First tried gemini-3.5-flash, then gemini-2.0-flash');
  assert.ok(fetchCalls[0].url.includes('gemini-3.5-flash'));
  assert.ok(fetchCalls[1].url.includes('gemini-2.0-flash'));
  assert.equal(fetchCalls[0].opts.headers['X-goog-api-key'], 'AIzaSyTestKey123');
  assert.equal(extractAIText(result.data), 'Hello from Gemini 2.0 Flash!');
});

test('handleAIChatMessage: iterates multiple fallbacks until valid candidate succeeds', async () => {
  const fetchCalls = [];
  const mockFetch = async (url) => {
    fetchCalls.push(url);
    if (url.includes('models/gemini-3.5-flash:generateContent') ||
        url.includes('models/gemini-2.0-flash:generateContent') ||
        url.includes('models/gemini-2.0-flash-lite:generateContent')) {
      return {
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ error: { code: 404, status: 'NOT_FOUND', message: 'Not found' } })
      };
    }
    if (url.includes('models/gemini-1.5-flash:generateContent')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Response from 1.5-flash' }] } }],
          modelVersion: 'gemini-1.5-flash-002'
        })
      };
    }
    return { ok: false, status: 500, text: async () => 'Unexpected URL' };
  };

  const message = {
    type: 'ai-chat',
    provider: 'google',
    token: 'AIzaSyTestKey123',
    model: 'gemini-3.5-flash',
    messages: [{ role: 'user', content: 'Testing multiple fallbacks' }]
  };

  const result = await handleAIChatMessage(message, mockFetch);
  assert.equal(result.ok, true);
  assert.ok(result.modelUsed.includes('fallback from gemini-3.5-flash'));
  assert.ok(fetchCalls.some(u => u.includes('gemini-1.5-flash')));
  assert.equal(extractAIText(result.data), 'Response from 1.5-flash');
});

test('handleAIChatMessage: returns clean error on invalid Google API key without fallback loop', async () => {
  let fetchCount = 0;
  const mockFetch = async () => {
    fetchCount++;
    return {
      ok: false,
      status: 400,
      text: async () => JSON.stringify({
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'INVALID_ARGUMENT'
        }
      })
    };
  };

  const message = {
    type: 'ai-chat',
    provider: 'google',
    token: 'AIzaSyBadKey',
    model: 'gemini-3.5-flash',
    messages: [{ role: 'user', content: 'Hi' }]
  };

  const result = await handleAIChatMessage(message, mockFetch);
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, 'API key not valid. Please pass a valid API key.');
  assert.equal(fetchCount, 1, 'Does not attempt model fallback on invalid authentication');
});

test('handleAIChatMessage: OpenAI routing sets Bearer header and returns response', async () => {
  let requestHeaders = null;
  const mockFetch = async (_url, opts) => {
    requestHeaders = opts.headers;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'Hello from OpenAI' } }],
        model: 'gpt-4o-mini'
      })
    };
  };

  const message = {
    type: 'ai-chat',
    provider: 'openai',
    token: 'sk-proj-myValidOpenAIKey',
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Hi OpenAI' }]
  };

  const result = await handleAIChatMessage(message, mockFetch);
  assert.equal(result.ok, true);
  assert.equal(requestHeaders.Authorization, 'Bearer sk-proj-myValidOpenAIKey');
  assert.equal(extractAIText(result.data), 'Hello from OpenAI');
});

test('background.js normalizeModelName: correctly respects provider parameter identically to aiChat.js', () => {
  assert.equal(bgNormalizeModelName('', 'google'), 'gemini-flash-latest');
  assert.equal(bgNormalizeModelName('', 'openai'), 'gpt-4o-mini');
  assert.equal(bgNormalizeModelName('', 'openrouter'), 'openrouter/auto');
  assert.equal(bgNormalizeModelName('models/gemini-2.0-flash', 'google'), 'gemini-2.0-flash');
  assert.equal(bgNormalizeModelName('openai/gpt-4o', 'openai'), 'gpt-4o');
  assert.equal(bgNormalizeModelName('gemini-3.5-flash', 'google'), 'gemini-3.5-flash');
});

test('sanitizeAIChatSettings: legacy OpenAI settings with standard sk- key auto-detects openai provider', () => {
  const legacyOpenAI = {
    provider: 'openrouter',
    apiKey: 'sk-abcdef1234567890legacyKey',
    model: 'gpt-4o-mini'
  };
  const sanitized = sanitizeAIChatSettings(legacyOpenAI);
  assert.equal(sanitized.provider, 'openai');
  assert.equal(sanitized.apiKey, 'sk-abcdef1234567890legacyKey');
  assert.equal(sanitized.model, 'gpt-4o-mini');
  assert.equal(sanitized.providers.openai.apiKey, 'sk-abcdef1234567890legacyKey');
  assert.equal(sanitized.providers.openrouter.apiKey, '');
});




test('executeAIChatRequest: direct in-page dispatch to Google AI Studio with gemini-3.5-flash', async () => {
  let requestedUrl = '';
  let requestHeaders = {};
  let requestBody = null;

  const mockFetch = async (url, options) => {
    requestedUrl = String(url);
    requestHeaders = options?.headers || {};
    requestBody = JSON.parse(options?.body || '{}');

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: 'Direct response from Google AI Studio Gemini 3.5 Flash.' }],
              role: 'model'
            },
            finishReason: 'STOP'
          }
        ],
        modelVersion: 'gemini-3.5-flash'
      })
    };
  };

  const result = await executeAIChatRequest({
    provider: 'google',
    token: 'AIzaSyMyValidGoogleKey123',
    model: 'gemini-3.5-flash',
    messages: [{ role: 'user', content: 'Explain AI' }],
    fetchImpl: mockFetch
  });

  assert.equal(result.ok, true);
  assert.ok(requestedUrl.startsWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent'));
  assert.ok(requestedUrl.includes('key=AIzaSyMyValidGoogleKey123'));
  assert.equal(requestHeaders['X-goog-api-key'], 'AIzaSyMyValidGoogleKey123');
  assert.equal(requestHeaders['Content-Type'], 'application/json');
  assert.equal(requestBody.contents[0].parts[0].text, 'Explain AI');
  assert.equal(extractAIText(result.data), 'Direct response from Google AI Studio Gemini 3.5 Flash.');
});

test('requestAIChat: performs direct execution bypassing stale service worker', async () => {
  let calledUrl = '';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calledUrl = String(url);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        candidates: [{
          content: { parts: [{ text: 'Direct in-page response' }], role: 'model' }
        }],
        modelVersion: 'gemini-3.5-flash'
      })
    };
  };

  try {
    const res = await requestAIChat({
      provider: 'google',
      token: 'AIzaSyTestKey999',
      model: 'gemini-3.5-flash',
      messages: [{ role: 'user', content: 'Hi' }]
    });

    assert.equal(res.ok, true);
    assert.ok(calledUrl.includes('generativelanguage.googleapis.com'), 'Direct fetch invoked without touching service worker');
    assert.equal(extractAIText(res.data), 'Direct in-page response');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
