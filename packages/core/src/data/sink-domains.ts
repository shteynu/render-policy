import type { SinkDenylist, SinkEntry } from '../sinks.js';

/**
 * Hosts that exist to receive whatever is sent to them. An agent that was
 * prompt-injected does not need a server of its own: an image pointing at a
 * request catcher, a tunnel or a public bucket is enough to carry the
 * conversation out.
 *
 * This file is data, not code. It is versioned separately from the library
 * and can be replaced at runtime through `createRenderer({ sinkDenylist })`.
 * It is a starting set, not an exhaustive one: pair it with an image host
 * allowlist and a CSP `img-src`.
 */
export const SINK_DENYLIST: SinkDenylist = Object.freeze({
  version: '2026-10-07',
  entries: Object.freeze<readonly SinkEntry[]>([
    // Out-of-band interaction services used to prove exfiltration.
    { pattern: 'interact.sh', category: 'oast' },
    { pattern: 'oast.fun', category: 'oast' },
    { pattern: 'oast.live', category: 'oast' },
    { pattern: 'oast.me', category: 'oast' },
    { pattern: 'oast.online', category: 'oast' },
    { pattern: 'oast.pro', category: 'oast' },
    { pattern: 'oast.site', category: 'oast' },
    { pattern: 'burpcollaborator.net', category: 'oast' },
    { pattern: 'oastify.com', category: 'oast' },
    { pattern: 'canarytokens.com', category: 'oast' },
    { pattern: 'dnslog.cn', category: 'oast' },
    { pattern: 'ceye.io', category: 'oast' },
    { pattern: 'requestrepo.com', category: 'oast' },

    // Request catchers and inbound webhooks.
    { pattern: 'webhook.site', category: 'webhook' },
    { pattern: 'requestbin.com', category: 'webhook' },
    { pattern: 'requestbin.net', category: 'webhook' },
    { pattern: 'pipedream.net', category: 'webhook' },
    { pattern: 'requestcatcher.com', category: 'webhook' },
    { pattern: 'hookbin.com', category: 'webhook' },
    { pattern: 'postb.in', category: 'webhook' },
    { pattern: 'beeceptor.com', category: 'webhook' },
    { pattern: 'mockbin.org', category: 'webhook' },
    { pattern: 'ptsv2.com', category: 'webhook' },
    { pattern: 'ptsv3.com', category: 'webhook' },
    { pattern: 'hooks.slack.com', category: 'webhook' },
    { pattern: 'hooks.zapier.com', category: 'webhook' },
    { pattern: 'maker.ifttt.com', category: 'webhook' },
    { pattern: 'discord.com/api/webhooks', category: 'webhook' },
    { pattern: 'discord.com/api/*/webhooks', category: 'webhook' },
    { pattern: 'discordapp.com/api/webhooks', category: 'webhook' },
    { pattern: 'discordapp.com/api/*/webhooks', category: 'webhook' },
    { pattern: 'webhook.office.com', category: 'webhook' },
    { pattern: 'chat.googleapis.com/v1/spaces', category: 'webhook' },
    { pattern: 'smee.io', category: 'webhook' },
    // The Bot API takes sendMessage as a GET: one link or image is a message to the attacker's bot.
    { pattern: 'api.telegram.org/bot', category: 'webhook' },

    // IP loggers: tracking links and pixels that show their creator every request.
    { pattern: 'iplogger.org', category: 'webhook' },
    { pattern: 'iplogger.com', category: 'webhook' },
    { pattern: 'yip.su', category: 'webhook' },
    { pattern: 'grabify.link', category: 'webhook' },

    // Tunnels that expose a laptop to the internet.
    { pattern: 'ngrok.io', category: 'tunnel' },
    { pattern: 'ngrok.app', category: 'tunnel' },
    { pattern: 'ngrok-free.app', category: 'tunnel' },
    { pattern: 'ngrok.dev', category: 'tunnel' },
    { pattern: 'ngrok-free.dev', category: 'tunnel' },
    { pattern: 'ngrok.pizza', category: 'tunnel' },
    { pattern: 'ngrok.pro', category: 'tunnel' },
    { pattern: 'loca.lt', category: 'tunnel' },
    { pattern: 'serveo.net', category: 'tunnel' },
    { pattern: 'trycloudflare.com', category: 'tunnel' },
    { pattern: 'localhost.run', category: 'tunnel' },
    { pattern: 'lhr.life', category: 'tunnel' },
    { pattern: 'pinggy.link', category: 'tunnel' },
    { pattern: 'pinggy-free.link', category: 'tunnel' },
    { pattern: 'share.zrok.io', category: 'tunnel' },
    { pattern: 'tunnelmole.net', category: 'tunnel' },
    { pattern: 'devtunnels.ms', category: 'tunnel' },
    // Codespaces forwarded ports; github.dev itself (the web editor) stays allowed.
    { pattern: 'app.github.dev', category: 'tunnel' },

    // Anonymous serverless endpoints.
    { pattern: 'workers.dev', category: 'serverless' },
    { pattern: 'val.run', category: 'serverless' },
    { pattern: 'deno.dev', category: 'serverless' },
    { pattern: 'repl.co', category: 'serverless' },
    { pattern: 'replit.app', category: 'serverless' },
    { pattern: 'replit.dev', category: 'serverless' },
    { pattern: 'lambda-url.*.on.aws', category: 'serverless' },

    // Forms: the agent asks the user to "confirm" something on a page the attacker owns.
    { pattern: 'forms.gle', category: 'forms' },
    { pattern: 'docs.google.com/forms', category: 'forms' },
    { pattern: 'forms.office.com', category: 'forms' },
    { pattern: 'forms.microsoft.com', category: 'forms' },
    { pattern: 'typeform.com', category: 'forms' },
    { pattern: 'jotform.com', category: 'forms' },
    { pattern: 'tally.so', category: 'forms' },
    { pattern: 'surveymonkey.com', category: 'forms' },
    { pattern: 'formspree.io', category: 'forms' },
    { pattern: 'getform.io', category: 'forms' },
    { pattern: 'formsubmit.co', category: 'forms' },
    { pattern: 'formcarry.com', category: 'forms' },
    { pattern: 'wufoo.com', category: 'forms' },
    { pattern: 'cognitoforms.com', category: 'forms' },
    { pattern: 'formstack.com', category: 'forms' },
    { pattern: 'paperform.co', category: 'forms' },
    { pattern: 'fillout.com', category: 'forms' },
    { pattern: 'forms.zohopublic.com', category: 'forms' },
    { pattern: 'usebasin.com', category: 'forms' },
    { pattern: 'web3forms.com', category: 'forms' },

    // Public object storage with anonymous write or logging.
    { pattern: 'blob.core.windows.net', category: 'blob-storage' },
    { pattern: 'dfs.core.windows.net', category: 'blob-storage' },
    { pattern: 'web.core.windows.net', category: 'blob-storage' },
    // S3: global, regional (s3.<region>), dual-stack, website and access-point endpoints, path-style
    // and virtual-hosted, and the legacy dash forms (s3-<region>, s3-website-<region>, s3-external-1).
    { pattern: 's3.amazonaws.com', category: 'blob-storage' },
    { pattern: 's3.*.amazonaws.com', category: 'blob-storage' },
    { pattern: 's3.dualstack.*.amazonaws.com', category: 'blob-storage' },
    { pattern: 's3-website.*.amazonaws.com', category: 'blob-storage' },
    { pattern: 's3-accesspoint.*.amazonaws.com', category: 'blob-storage' },
    { pattern: 's3-*.amazonaws.com', category: 'blob-storage' },
    { pattern: 'storage.googleapis.com', category: 'blob-storage' },
    { pattern: 'r2.dev', category: 'blob-storage' },
    { pattern: 'digitaloceanspaces.com', category: 'blob-storage' },
    { pattern: 'backblazeb2.com', category: 'blob-storage' },
    { pattern: 'wasabisys.com', category: 'blob-storage' },
    // S3-compatible stores: an account anyone can open, then a presigned upload or a public bucket.
    // A `*` in the regional label keeps `<endpoint>` itself (path-style, any bucket) apart from `<bucket>.<endpoint>`.
    { pattern: 'r2.cloudflarestorage.com', category: 'blob-storage' },
    { pattern: '*.linodeobjects.com', category: 'blob-storage' },
    { pattern: 'storage.yandexcloud.net', category: 'blob-storage' },
    { pattern: 'oss-*.aliyuncs.com', category: 'blob-storage' },
    { pattern: 'cos.*.myqcloud.com', category: 'blob-storage' },
    { pattern: 's3.*.scw.cloud', category: 'blob-storage' },
    { pattern: 's3.*.cloud-object-storage.appdomain.cloud', category: 'blob-storage' },
    { pattern: 'objectstorage.*.oraclecloud.com', category: 'blob-storage' },
    { pattern: '*.your-objectstorage.com', category: 'blob-storage' },
    { pattern: 'gateway.storjshare.io', category: 'blob-storage' },
    { pattern: 'link.storjshare.io', category: 'blob-storage' },
    // Backend platforms whose project host serves public storage and functions.
    { pattern: 'firebasestorage.googleapis.com', category: 'blob-storage' },
    { pattern: 'public.blob.vercel-storage.com', category: 'blob-storage' },
    { pattern: 'supabase.co', category: 'blob-storage' },
    { pattern: 'file.io', category: 'blob-storage' },
    { pattern: 'transfer.sh', category: 'blob-storage' },
    { pattern: '0x0.st', category: 'blob-storage' },
    { pattern: 'catbox.moe', category: 'blob-storage' },
    { pattern: 'tmpfiles.org', category: 'blob-storage' },
    { pattern: 'gofile.io', category: 'blob-storage' },
  ]),
});
