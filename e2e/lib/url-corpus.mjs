/**
 * A systematic corpus of URL strings for the parity check between the policy's URL
 * classification and what Chromium actually resolves: schemes in many spellings, control
 * characters at every position, look-alike separators, prefixes that turn a scheme into a
 * path, and hosts with credentials, encodings and confusables.
 */
const SCHEMES = [
  'javascript', 'JavaScript', 'JAVASCRIPT', 'jAvAsCrIpT', 'data', 'DATA', 'vbscript', 'blob', 'file', 'ftp', 'about',
  'jar', 'ws', 'wss', 'chrome', 'view-source', 'mailto', 'tel', 'http', 'https', 'HTTP', 'HtTpS', 'myapp', 'java\u0000script',
];
const BODIES = ['alert(1)', '//evil.example/x', 'text/html,<script>1</script>', '///etc/passwd'];
const CONTROLS = ['\t', '\n', '\r', '\x00', '\x01', '\x0b', '\x0c', '\x1f', ' ', '\x7f', '\xa0', ' ', ' ', '​', '‍', '﻿', '᠎'];
const SEPARATORS = [':', '：', '%3A', ':\x00', '::', ' :', ':/', '://'];
const PREFIXES = ['', ' ', '/', '//', '\\', '\\\\', '/\\', '\\/', '///', '////', 'http:', 'https:', 'https://good.example/?u=', '#', '?'];
const HOSTS = [
  '//evil.example/x', '\\\\evil.example\\x', '/\\evil.example/x', '\\/evil.example/x', '///evil.example/x', '////evil.example/x',
  'http:evil.example/x', 'http:/evil.example/x', 'http:\\\\evil.example/x', 'https:\\/\\/evil.example/x', '\u0001//evil.example/x',
  'HTTPS://EVIL.EXAMPLE/x', 'https://evil.example\\@good.example/', 'https://good.example@evil.example/', 'https://good.example%40evil.example/',
  'https://evil.example%2F@good.example/', 'https://ｅｖｉｌ.example/', 'https://xn--80ak6aa92e.example/', 'https://evil.example:8080/',
  'https://evil.example:443/', 'https://127.0.0.1/', 'https://[::1]/', 'https://0x7f000001/', 'https://2130706433/', 'https://evil.example./',
  'https://evil.example%00.good.example/', 'https://evil.example\t.good.example/', 'https://evil.example​.good.example/',
  'https://good.example.evil.example/', 'https://evil.example#@good.example/', 'https://evil.example?@good.example/',
  'https:evil.example', 'https:///evil.example/', 'https:\\evil.example', 'HTTPS:\\\\EVIL.EXAMPLE',
  '/x', 'x', '#f', '?q', './a.png', '../a.png', 'a:b', 'localhost:8080/x', 'evil.example/x',
];

export function generateUrlCorpus() {
  const out = new Set();
  const bases = [];
  for (const scheme of SCHEMES) for (const separator of SEPARATORS) for (const body of BODIES) bases.push(`${scheme}${separator}${body}`);
  for (const base of bases) {
    out.add(base);
    for (const prefix of PREFIXES) out.add(prefix + base);
    const colon = base.indexOf(':') === -1 ? Math.floor(base.length / 2) : base.indexOf(':');
    const positions = [0, 1, Math.max(1, colon - 1), colon, colon + 1, base.length];
    for (const control of CONTROLS) {
      for (const position of positions) out.add(base.slice(0, position) + control + base.slice(position));
      out.add(control + control + base);
      out.add(base.split('').join(control).slice(0, 200));
    }
  }
  for (const host of HOSTS) {
    out.add(host);
    for (const control of CONTROLS) out.add(control + host);
    for (const prefix of PREFIXES) out.add(prefix + host);
  }
  return Array.from(out);
}
