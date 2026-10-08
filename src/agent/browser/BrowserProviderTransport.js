import {HttpTransport} from '../providers/HttpTransport.js';
import {AgentError} from '../core/AgentError.js';

/** Direct BYOK only. A model/tool can never redirect browser credentials to a configurable origin. */
export class BrowserProviderTransport extends HttpTransport {
  async request(input, options = {}) {
    const url = new URL(input);
    const routes = {
      'https://api.openai.com': /^\/v1\/(?:models|responses)$/,
      'https://api.anthropic.com': /^\/v1\/(?:models|messages)$/,
      'https://generativelanguage.googleapis.com': /^\/v1beta\/models(?:\/[A-Za-z0-9._-]+:streamGenerateContent)?$/
    };
    if (url.username || url.password || url.hash || !Object.hasOwn(routes, url.origin) || !routes[url.origin].test(url.pathname))
      throw new AgentError('PROVIDER_ORIGIN', 'Direct browser API credentials may only be sent to supported official provider endpoints');
    const headers = {...options.headers};
    if (url.origin === 'https://api.anthropic.com') headers['anthropic-dangerous-direct-browser-access'] = 'true';
    return super.request(url.href, {...options, headers});
  }
}
