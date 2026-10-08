import {JsonSchema} from '../core/JsonSchema.js';
export const text = (maxLength = 16000) => ({type: 'string', maxLength});
export const path = {...text(2048), description: 'Workspace-relative path. Traversal, symlinks and credential paths are denied.'};
export const integer = (minimum, maximum) => ({type: 'integer', minimum, maximum});
export const object = JsonSchema.object;
export const hash = {type: ['string', 'null'], pattern: '^[a-f0-9]{64}$', description: 'SHA-256 returned by workspace_read; null asserts that the file does not exist.'};
export const changes = {type: 'array', minItems: 1, maxItems: 100, items: object({path, expectedHash: hash, text: {type: ['string', 'null'], maxLength: 2 * 1024 * 1024, description: 'Complete UTF-8 replacement, or null to delete.'}})};
export const position = object({line: integer(0, 1000000), character: integer(0, 1000000)});
