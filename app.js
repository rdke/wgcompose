const state = { clients: [], servers: [], vpnProvider: null };

function sysctlPostUp() {
  const lines = [
    'PostUp = sysctl -wq net.ipv4.ip_forward=1',
    'PostUp = sysctl -wq net.ipv4.conf.all.rp_filter=2',
    'PostUp = sysctl -wq net.ipv4.conf.default.rp_filter=2'
  ];
  if (ipv6Enabled()) {
    lines.push('PostUp = sysctl -wq net.ipv6.conf.all.forwarding=1');
    lines.push('PostUp = sysctl -wq net.ipv6.conf.default.forwarding=1');
  }
  return lines.join('\n');
}

function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k === 'disabled' || k === 'checked') e[k] = !!v;
      else e.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    e.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function svgEl(tag, attrs, ...children) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      e.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c == null) continue;
    e.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

function chevronDownIcon() {
  return svgEl('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
    svgEl('polyline', { points: '6 9 12 15 18 9' })
  );
}

function xIcon() {
  return svgEl('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
    svgEl('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
    svgEl('line', { x1: 6, y1: 6, x2: 18, y2: 18 })
  );
}

function makeClient() {
  return { priv: '', pub: '' };
}

function makeServer() {
  return { host: '', port: '51820', iface: 'eth0', priv: '', pub: '' };
}

function makeVpnProvider() {
  return { priv: '', providerPub: '', address: '', host: '', port: '51820' };
}

function parseSubnet(s) {
  const m = String(s).trim().match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/);
  if (!m) return null;
  const a = +m[1], b = +m[2], c = +m[3], d = +m[4], pfx = +m[5];
  if ([a, b, c, d].some(x => x < 0 || x > 255) || pfx < 8 || pfx > 30) return null;
  const ip32 = (((a << 24) | (b << 16) | (c << 8) | d) >>> 0);
  const mask = pfx === 0 ? 0 : (0xFFFFFFFF << (32 - pfx)) >>> 0;
  const network = (ip32 & mask) >>> 0;
  return { network: network, prefix: pfx };
}

function intToIP(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');
}

function networkStr(parsed) {
  return intToIP(parsed.network) + '/' + parsed.prefix;
}

function ipFor(role, idx, parsed) {
  const numClients = state.clients.length;
  let offset;
  if (role === 'server') {
    offset = (idx === 0) ? 1 : (numClients + 1 + idx);
  } else {
    offset = idx + 2;
  }
  return intToIP((parsed.network + offset) >>> 0);
}

function parseSubnet6(s) {
  const m = String(s).trim().match(/^([\da-fA-F:]+)\/(\d+)$/);
  if (!m) return null;
  const addrStr = m[1];
  const pfx = +m[2];
  if (pfx < 8 || pfx > 128) return null;
  let parts;
  if (addrStr.includes('::')) {
    const split = addrStr.split('::');
    if (split.length > 2) return null;
    const head = split[0] ? split[0].split(':') : [];
    const tail = split[1] ? split[1].split(':') : [];
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    parts = [...head, ...Array(missing).fill('0'), ...tail];
  } else {
    parts = addrStr.split(':');
  }
  if (parts.length !== 8) return null;
  let n = 0n;
  for (const p of parts) {
    if (!/^[\da-fA-F]{1,4}$/.test(p)) return null;
    n = (n << 16n) | BigInt(parseInt(p, 16));
  }
  const all = (1n << 128n) - 1n;
  const mask = pfx === 0 ? 0n : ((all << BigInt(128 - pfx)) & all);
  return { network: n & mask, prefix: pfx };
}

function intToIP6(n) {
  const groups = [];
  for (let i = 7; i >= 0; i--) {
    groups.push(((n >> BigInt(i * 16)) & 0xffffn).toString(16));
  }
  let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
  for (let i = 0; i <= groups.length; i++) {
    if (i < groups.length && groups[i] === '0') {
      if (curStart === -1) curStart = i;
      curLen++;
    } else {
      if (curLen > bestLen) { bestStart = curStart; bestLen = curLen; }
      curStart = -1; curLen = 0;
    }
  }
  if (bestLen >= 2) {
    const before = groups.slice(0, bestStart).join(':');
    const after = groups.slice(bestStart + bestLen).join(':');
    return before + '::' + after;
  }
  return groups.join(':');
}

function networkStr6(p6) {
  return intToIP6(p6.network) + '/' + p6.prefix;
}

function ipFor6(role, idx, p6) {
  const numClients = state.clients.length;
  let offset;
  if (role === 'server') {
    offset = (idx === 0) ? 1 : (numClients + 1 + idx);
  } else {
    offset = idx + 2;
  }
  return intToIP6(p6.network + BigInt(offset));
}

function ipv6Mode() {
  return document.getElementById('ipv6-mode').value;
}

function ipv6Enabled() {
  return getSubnet6() !== null;
}

function getSubnet6() {
  const mode = ipv6Mode();
  if (mode === 'off') return null;
  if (mode === 'custom') {
    const v = document.getElementById('subnet6').value;
    return v ? parseSubnet6(v) : null;
  }
  return parseSubnet6(mode);
}

async function generateKeypair() {
  const kp = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  const rawPriv = pkcs8.slice(-32);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const b64 = (u8) => btoa(String.fromCharCode.apply(null, u8));
  return { private: b64(rawPriv), public: b64(rawPub) };
}

async function derivePub(privBase64) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(privBase64)) return null;
  try {
    const raw = Uint8Array.from(atob(privBase64), c => c.charCodeAt(0));
    if (raw.length !== 32) return null;
    const pkcs8 = new Uint8Array(48);
    pkcs8.set([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20], 0);
    pkcs8.set(raw, 16);
    const privKey = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, true, ['deriveBits']);
    const jwk = await crypto.subtle.exportKey('jwk', privKey);
    let xB64 = jwk.x.replace(/-/g, '+').replace(/_/g, '/');
    while (xB64.length % 4) xB64 += '=';
    const pubBytes = Uint8Array.from(atob(xB64), c => c.charCodeAt(0));
    return btoa(String.fromCharCode.apply(null, pubBytes));
  } catch (e) { return null; }
}

async function checkWebCrypto() {
  try {
    if (!crypto || !crypto.subtle || !crypto.subtle.generateKey) return false;
    await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
    return true;
  } catch (e) { return false; }
}

function keyInput(attr, fieldName, idx, value, label) {
  const inputAttrs = { type: 'text', [attr]: fieldName, value: value };
  if (idx != null) inputAttrs['data-idx'] = idx;
  return el('div', null,
    el('label', null, label),
    el('input', inputAttrs)
  );
}

function buildClientForm(c, i, n) {
  return el('div', { class: 'section', 'data-client-idx': i },
    el('div', { class: 'server-header' },
      el('h2', null, n === 1 ? 'Client' : 'Client ' + (i + 1)),
      i === 0 ? null : el('button', { class: 'danger', 'data-action': 'remove-client', 'data-idx': i, title: 'Remove', 'aria-label': 'Remove' }, xIcon())
    ),
    el('div', { class: 'keys-row' },
      keyInput('data-cfield', 'priv', i, c.priv, 'Private key'),
      keyInput('data-cfield', 'pub', i, c.pub, 'Public key'),
      el('button', { class: 'dark-gray', 'data-action': 'gen-client', 'data-idx': i }, 'Generate')
    )
  );
}

function renderClientList() {
  const list = document.getElementById('client-list');
  clear(list);
  const n = state.clients.length;
  state.clients.forEach((c, i) => list.appendChild(buildClientForm(c, i, n)));
}

function buildServerForm(s, i, n) {
  const isLast = i === n - 1;
  return el('div', { class: 'section', 'data-idx': i },
    el('div', { class: 'server-header' },
      el('h2', null, n === 1 ? 'Server' : 'Server ' + (i + 1)),
      i === 0 ? null : el('button', { class: 'danger', 'data-action': 'remove', 'data-idx': i, title: 'Remove', 'aria-label': 'Remove' }, xIcon())
    ),
    el('div', { class: 'row' },
      el('div', null,
        el('label', null, 'Hostname'),
        el('input', { type: 'text', 'data-field': 'host', 'data-idx': i, value: s.host, placeholder: 'vpn.example.com' })
      ),
      el('div', { class: 'col-narrow' },
        el('label', null, 'Port'),
        el('input', { type: 'number', 'data-field': 'port', 'data-idx': i, value: s.port || '51820' })
      ),
      (isLast && !state.vpnProvider) ? el('div', { class: 'col-narrow' },
        el('label', null, 'Interface'),
        el('input', { type: 'text', 'data-field': 'iface', 'data-idx': i, value: s.iface || 'eth0' })
      ) : null
    ),
    el('div', { class: 'keys-row' },
      keyInput('data-field', 'priv', i, s.priv, 'Private key'),
      keyInput('data-field', 'pub', i, s.pub, 'Public key'),
      el('button', { class: 'dark-gray', 'data-action': 'gen', 'data-idx': i }, 'Generate')
    )
  );
}

function buildVpnProviderForm() {
  const v = state.vpnProvider;
  return el('div', { class: 'section' },
    el('div', { class: 'server-header' },
      el('h2', null, 'VPN Provider'),
      el('button', { class: 'danger', 'data-action': 'remove-vpnprovider', title: 'Remove', 'aria-label': 'Remove' }, xIcon())
    ),
    el('div', { class: 'row' },
      el('div', null,
        el('label', null, 'Hostname'),
        el('input', { type: 'text', 'data-vfield': 'host', value: v.host, placeholder: 'vpn.example.com' })
      ),
      el('div', { class: 'col-narrow' },
        el('label', null, 'Port'),
        el('input', { type: 'number', 'data-vfield': 'port', value: v.port || '51820' })
      )
    ),
    el('div', { class: 'keys-row' },
      keyInput('data-vfield', 'priv', null, v.priv, 'Private key'),
      keyInput('data-vfield', 'providerPub', null, v.providerPub, 'Public key')
    ),
    el('div', null,
      el('label', null, 'Address'),
      el('input', { type: 'text', 'data-vfield': 'address', value: v.address, placeholder: '10.66.0.1/32, fc00:bbbb:bbbb:bb01::3:8e39/128' })
    )
  );
}

function renderVpnProvider() {
  const list = document.getElementById('vpnprovider-list');
  clear(list);
  const btn = document.getElementById('add-vpnprovider');
  if (state.vpnProvider) {
    list.appendChild(buildVpnProviderForm());
    btn.style.display = 'none';
  } else {
    btn.style.display = '';
  }
}

function renderServerList() {
  const list = document.getElementById('server-list');
  clear(list);
  const n = state.servers.length;
  state.servers.forEach((s, i) => list.appendChild(buildServerForm(s, i, n)));
}

function fullAllowedIPs() {
  return ipv6Enabled() ? '0.0.0.0/0, ::/0' : '0.0.0.0/0';
}

function getDNS() {
  const isCustom = document.getElementById('dns-picker').classList.contains('custom');
  if (isCustom) return document.getElementById('dns-custom').value || '8.8.8.8';
  const preset = document.getElementById('dns-preset').value;
  const ipv6 = ipv6Enabled();
  if (preset === '8.8.8.8') return ipv6 ? '8.8.8.8, 8.8.4.4, 2001:4860:4860::8888, 2001:4860:4860::8844' : '8.8.8.8, 8.8.4.4';
  if (preset === '1.1.1.1') return ipv6 ? '1.1.1.1, 1.0.0.1, 2606:4700:4700::1111, 2606:4700:4700::1001' : '1.1.1.1, 1.0.0.1';
  return preset;
}

function recommendedMTU(n) {
  return 1500 - 80 * Math.max(n, 1);
}

function getMTU() {
  const isCustom = document.getElementById('mtu-picker').classList.contains('custom');
  if (isCustom) return document.getElementById('mtu').value || String(recommendedMTU(state.servers.length));
  const mode = document.getElementById('mtu-mode').value;
  if (mode === 'auto') return String(recommendedMTU(state.servers.length));
  return mode;
}

function getKeepalive() {
  return document.getElementById('keepalive').value || '10';
}

function buildClientConf(parsed, idx) {
  const c = state.clients[idx] || {};
  const clientIP = ipFor('client', idx, parsed);
  const dns = getDNS();
  const mtu = getMTU();
  const cPriv = c.priv || '<CLIENT_PRIVATE_KEY>';
  const s1 = state.servers[0];
  const s1Pub = (s1 && s1.pub) || '<SERVER1_PUBLIC_KEY>';
  const s1Host = (s1 && s1.host) || '<SERVER1_HOST>';
  const s1Port = (s1 && s1.port) || '51820';
  const ipv6 = ipv6Enabled();
  const p6 = getSubnet6();
  const addressLine = (ipv6 && p6)
    ? `${clientIP}/${parsed.prefix}, ${ipFor6('client', idx, p6)}/${p6.prefix}`
    : `${clientIP}/${parsed.prefix}`;
  // Linux kill switch via iptables/ip6tables — silently ignored on macOS, Windows, mobile.
  const postUps = ['iptables -I OUTPUT ! -o %i -m mark ! --mark $(wg show %i fwmark) -m addrtype ! --dst-type LOCAL -j REJECT'];
  const preDowns = ['iptables -D OUTPUT ! -o %i -m mark ! --mark $(wg show %i fwmark) -m addrtype ! --dst-type LOCAL -j REJECT'];
  if (ipv6) {
    postUps.push('ip6tables -I OUTPUT ! -o %i -m mark ! --mark $(wg show %i fwmark) -m addrtype ! --dst-type LOCAL -j REJECT');
    preDowns.push('ip6tables -D OUTPUT ! -o %i -m mark ! --mark $(wg show %i fwmark) -m addrtype ! --dst-type LOCAL -j REJECT');
  } else {
    postUps.push('ip6tables -I OUTPUT ! -o lo -j REJECT');
    preDowns.push('ip6tables -D OUTPUT ! -o lo -j REJECT');
  }
  const ks = '\n\n' + postUps.map(l => 'PostUp = ' + l).join('\n') + '\n\n' + preDowns.map(l => 'PreDown = ' + l).join('\n');
  return `[Interface]
PrivateKey = ${cPriv}
Address = ${addressLine}
DNS = ${dns}
MTU = ${mtu}${ks}

[Peer]
PublicKey = ${s1Pub}
AllowedIPs = ${fullAllowedIPs()}
Endpoint = ${s1Host}:${s1Port}
PersistentKeepalive = ${getKeepalive()}
`;
}

function prevPeerBlock(i, parsed) {
  const p6 = getSubnet6();
  if (i === 0) {
    const clients = state.clients.length ? state.clients : [{}];
    return clients.map((c, ci) => {
      const cPub = c.pub || '<CLIENT_PUBLIC_KEY>';
      const cIP = ipFor('client', ci, parsed);
      const allowed = p6 ? `${cIP}/32, ${ipFor6('client', ci, p6)}/128` : `${cIP}/32`;
      return `[Peer]
PublicKey = ${cPub}
AllowedIPs = ${allowed}
`;
    }).join('\n');
  }
  const prev = state.servers[i - 1];
  const prevPub = (prev && prev.pub) || '<PREV_HOP_PUBLIC_KEY>';
  const allowed = p6 ? `${networkStr(parsed)}, ${networkStr6(p6)}` : networkStr(parsed);
  return `[Peer]
PublicKey = ${prevPub}
AllowedIPs = ${allowed}
`;
}

function buildForwarderConf(i, parsed) {
  const subnet = networkStr(parsed);
  const me = state.servers[i];
  const next = state.servers[i + 1];
  const myIP = ipFor('server', i, parsed);
  const myPriv = me.priv || '<PRIVATE_KEY>';
  const myPort = me.port || '51820';
  const nextPub = (next && next.pub) || '<NEXT_HOP_PUBLIC_KEY>';
  const nextHost = (next && next.host) || '<NEXT_HOP_HOST>';
  const nextPort = (next && next.port) || '51820';
  const p6 = getSubnet6();
  const subnet6 = p6 ? networkStr6(p6) : null;
  const addressLine = p6
    ? `${myIP}/${parsed.prefix}, ${ipFor6('server', i, p6)}/${p6.prefix}`
    : `${myIP}/${parsed.prefix}`;

  const v6PostUp = p6 ? `
PostUp = ip -6 route add default dev %i table 200
PostUp = ip -6 route replace unreachable default table 200 metric 4096
PostUp = ip -6 rule add from ${subnet6} lookup 200 pref 32765
PostUp = ip -6 rule add to ${subnet6} lookup main pref 32762
PostUp = ip6tables -A FORWARD -i %i -j ACCEPT
PostUp = ip6tables -A FORWARD -o %i -j ACCEPT
PostUp = ip6tables -t nat -A POSTROUTING -s ${subnet6} -o %i -j MASQUERADE
PostUp = ip6tables -t mangle -A FORWARD -o %i -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
PostUp = ip6tables -t mangle -A FORWARD -i %i -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu` : '';

  const v6PostDown = p6 ? `
PostDown = ip -6 rule del to ${subnet6} lookup main pref 32762 2>/dev/null || true
PostDown = ip -6 rule del from ${subnet6} lookup 200 pref 32765 2>/dev/null || true
PostDown = ip -6 route del unreachable default table 200 metric 4096 2>/dev/null || true
PostDown = ip -6 route del default dev %i table 200 2>/dev/null || true
PostDown = ip6tables -D FORWARD -i %i -j ACCEPT 2>/dev/null || true
PostDown = ip6tables -D FORWARD -o %i -j ACCEPT 2>/dev/null || true
PostDown = ip6tables -t nat -D POSTROUTING -s ${subnet6} -o %i -j MASQUERADE 2>/dev/null || true
PostDown = ip6tables -t mangle -D FORWARD -o %i -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true
PostDown = ip6tables -t mangle -D FORWARD -i %i -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true` : '';

  return `[Interface]
PrivateKey = ${myPriv}
Address = ${addressLine}
ListenPort = ${myPort}
MTU = ${getMTU()}
Table = off

${sysctlPostUp()}
PostUp = ip route add default dev %i table 200
PostUp = ip route replace unreachable default table 200 metric 4096
PostUp = ip rule add from ${subnet} lookup 200 pref 32765
PostUp = ip rule add to ${subnet} lookup main pref 32762
PostUp = iptables -A FORWARD -i %i -j ACCEPT
PostUp = iptables -A FORWARD -o %i -j ACCEPT
PostUp = iptables -t nat -A POSTROUTING -s ${subnet} -o %i -j MASQUERADE
PostUp = iptables -t mangle -A FORWARD -o %i -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
PostUp = iptables -t mangle -A FORWARD -i %i -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu${v6PostUp}

PostDown = ip rule del to ${subnet} lookup main pref 32762 2>/dev/null || true
PostDown = ip rule del from ${subnet} lookup 200 pref 32765 2>/dev/null || true
PostDown = ip route del unreachable default table 200 metric 4096 2>/dev/null || true
PostDown = ip route del default dev %i table 200 2>/dev/null || true
PostDown = iptables -D FORWARD -i %i -j ACCEPT 2>/dev/null || true
PostDown = iptables -D FORWARD -o %i -j ACCEPT 2>/dev/null || true
PostDown = iptables -t nat -D POSTROUTING -s ${subnet} -o %i -j MASQUERADE 2>/dev/null || true
PostDown = iptables -t mangle -D FORWARD -o %i -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true
PostDown = iptables -t mangle -D FORWARD -i %i -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true${v6PostDown}

[Peer]
PublicKey = ${nextPub}
Endpoint = ${nextHost}:${nextPort}
AllowedIPs = ${fullAllowedIPs()}
PersistentKeepalive = ${getKeepalive()}

${prevPeerBlock(i, parsed)}`;
}

function buildLastConf(i, parsed) {
  const subnet = networkStr(parsed);
  const me = state.servers[i];
  const myIP = ipFor('server', i, parsed);
  const myPriv = me.priv || '<PRIVATE_KEY>';
  const myPort = me.port || '51820';
  const p6 = getSubnet6();
  const subnet6 = p6 ? networkStr6(p6) : null;
  const addressLine = p6
    ? `${myIP}/${parsed.prefix}, ${ipFor6('server', i, p6)}/${p6.prefix}`
    : `${myIP}/${parsed.prefix}`;

  const wan = state.vpnProvider ? 'wg1' : (me.iface || 'eth0');

  const vpnProviderPostUp = state.vpnProvider ? `
PostUp = ip route replace unreachable default table 300 metric 4096
PostUp = ip rule add from ${subnet} lookup 300 pref 32700${p6 ? `
PostUp = ip -6 route replace unreachable default table 300 metric 4096
PostUp = ip -6 rule add from ${subnet6} lookup 300 pref 32700` : ''}` : '';

  const vpnProviderPostDown = state.vpnProvider ? `
PostDown = ip rule del from ${subnet} lookup 300 pref 32700 2>/dev/null || true
PostDown = ip route del unreachable default table 300 metric 4096 2>/dev/null || true${p6 ? `
PostDown = ip -6 rule del from ${subnet6} lookup 300 pref 32700 2>/dev/null || true
PostDown = ip -6 route del unreachable default table 300 metric 4096 2>/dev/null || true` : ''}` : '';

  const v6PostUp = p6 ? `
PostUp = ip6tables -A FORWARD -i %i -j ACCEPT
PostUp = ip6tables -A FORWARD -o %i -j ACCEPT
PostUp = ip6tables -t nat -A POSTROUTING -s ${subnet6} -o ${wan} -j MASQUERADE
PostUp = ip6tables -t mangle -A FORWARD -o %i -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
PostUp = ip6tables -t mangle -A FORWARD -i %i -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu` : '';

  const v6PostDown = p6 ? `
PostDown = ip6tables -D FORWARD -i %i -j ACCEPT 2>/dev/null || true
PostDown = ip6tables -D FORWARD -o %i -j ACCEPT 2>/dev/null || true
PostDown = ip6tables -t nat -D POSTROUTING -s ${subnet6} -o ${wan} -j MASQUERADE 2>/dev/null || true
PostDown = ip6tables -t mangle -D FORWARD -o %i -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true
PostDown = ip6tables -t mangle -D FORWARD -i %i -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true` : '';

  return `[Interface]
PrivateKey = ${myPriv}
Address = ${addressLine}
ListenPort = ${myPort}
MTU = ${getMTU()}

${sysctlPostUp()}
PostUp = iptables -A FORWARD -i %i -j ACCEPT
PostUp = iptables -A FORWARD -o %i -j ACCEPT
PostUp = iptables -t nat -A POSTROUTING -s ${subnet} -o ${wan} -j MASQUERADE
PostUp = iptables -t mangle -A FORWARD -o %i -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
PostUp = iptables -t mangle -A FORWARD -i %i -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu${v6PostUp}${vpnProviderPostUp}

PostDown = iptables -D FORWARD -i %i -j ACCEPT 2>/dev/null || true
PostDown = iptables -D FORWARD -o %i -j ACCEPT 2>/dev/null || true
PostDown = iptables -t nat -D POSTROUTING -s ${subnet} -o ${wan} -j MASQUERADE 2>/dev/null || true
PostDown = iptables -t mangle -D FORWARD -o %i -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true
PostDown = iptables -t mangle -D FORWARD -i %i -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || true${v6PostDown}${vpnProviderPostDown}

${prevPeerBlock(i, parsed)}`;
}

function buildVpnProviderConf() {
  const v = state.vpnProvider || {};
  const priv = v.priv || '<PRIVATE_KEY>';
  const pPub = v.providerPub || '<PROVIDER_PUBLIC_KEY>';
  const address = v.address || '<PROVIDER_ADDRESS>';
  const host = v.host || '<PROVIDER_HOST>';
  const port = v.port || '51820';
  return `[Interface]
PrivateKey = ${priv}
Address = ${address}
Table = 300

[Peer]
PublicKey = ${pPub}
Endpoint = ${host}:${port}
AllowedIPs = ${fullAllowedIPs()}
PersistentKeepalive = ${getKeepalive()}
`;
}

function buildServerSetup(i, parsed) {
  const isLast = i === state.servers.length - 1;
  const conf = isLast ? buildLastConf(i, parsed) : buildForwarderConf(i, parsed);
  const cmd = (s) => el('span', { class: 'cmd' }, s);
  const parts = [
    cmd("cat > /etc/wireguard/wg0.conf <<'EOF'"),
    '\n',
    conf,
    'EOF\n'
  ];
  if (isLast && state.vpnProvider) {
    parts.push(
      '\n',
      cmd("cat > /etc/wireguard/wg1.conf <<'EOF'"),
      '\n',
      buildVpnProviderConf(),
      'EOF\n',
      '\n',
      cmd('systemctl enable --now wg-quick@wg1 wg-quick@wg0'),
      '\n'
    );
  } else {
    parts.push(
      '\n',
      cmd('systemctl enable --now wg-quick@wg0'),
      '\n'
    );
  }
  return parts;
}

function makeCodeBlock(content, opts) {
  const buttons = [
    el('button', { class: 'copy', 'aria-label': 'Copy to clipboard' }, 'COPY')
  ];
  if (opts && opts.download) {
    buttons.push(
      el('button', { class: 'download', 'aria-label': 'Download', 'data-filename': opts.download }, 'DOWNLOAD')
    );
  }
  const children = Array.isArray(content) ? content : [content];
  return el('div', { class: 'code-block' },
    el('div', { class: 'pre-actions' }, ...buttons),
    el('pre', null, el('code', null, ...children))
  );
}

function renderOutput() {
  const out = document.getElementById('output');
  clear(out);
  const parsed = parseSubnet(document.getElementById('subnet').value);
  if (!parsed) {
    const err = el('div', { class: 'err' });
    err.appendChild(document.createTextNode('Invalid subnet. Expected format like '));
    err.appendChild(el('code', null, '10.69.69.0/24'));
    err.appendChild(document.createTextNode('.'));
    out.appendChild(err);
    return;
  }
  const numClients = state.clients.length;
  const n = state.servers.length;

  state.clients.forEach((c, ci) => {
    const label = numClients === 1 ? 'Client' : 'Client ' + (ci + 1);
    out.appendChild(el('h3', null, label));
    const filename = numClients === 1 ? 'client.conf' : 'client' + (ci + 1) + '.conf';
    out.appendChild(makeCodeBlock(buildClientConf(parsed, ci), { download: filename }));
  });

  state.servers.forEach((s, i) => {
    out.appendChild(el('h3', null, n === 1 ? 'Server' : 'Server ' + (i + 1)));
    out.appendChild(makeCodeBlock(buildServerSetup(i, parsed)));
  });
}

function fullRender() {
  renderClientList();
  renderServerList();
  renderVpnProvider();
  renderOutput();
}

document.getElementById('add-server').addEventListener('click', () => {
  state.servers.push(makeServer());
  fullRender();
});

document.getElementById('server-list').addEventListener('click', async (e) => {
  const btn = e.target.closest && e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'remove') {
    const idx = +btn.dataset.idx;
    state.servers.splice(idx, 1);
    fullRender();
  } else if (action === 'gen') {
    const idx = +btn.dataset.idx;
    btn.disabled = true;
    try {
      const kp = await generateKeypair();
      state.servers[idx].priv = kp.private;
      state.servers[idx].pub = kp.public;
      fullRender();
    } catch (err) {
      console.error(err);
      btn.disabled = false;
    }
  }
});

document.getElementById('server-list').addEventListener('input', async (e) => {
  const field = e.target.dataset.field;
  if (!field) return;
  const idx = +e.target.dataset.idx;
  state.servers[idx][field] = e.target.value;
  renderOutput();
  if (field === 'priv') {
    const startVal = e.target.value;
    const pub = await derivePub(startVal);
    if (pub && state.servers[idx] && state.servers[idx].priv === startVal) {
      state.servers[idx].pub = pub;
      const pubInput = document.querySelector('input[data-field="pub"][data-idx="' + idx + '"]');
      if (pubInput) pubInput.value = pub;
      renderOutput();
    }
  }
});

document.getElementById('add-client').addEventListener('click', () => {
  state.clients.push(makeClient());
  fullRender();
});

document.getElementById('add-vpnprovider').addEventListener('click', () => {
  state.vpnProvider = makeVpnProvider();
  fullRender();
});

document.getElementById('vpnprovider-list').addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('button[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'remove-vpnprovider') {
    state.vpnProvider = null;
    fullRender();
  }
});

document.getElementById('vpnprovider-list').addEventListener('input', (e) => {
  const field = e.target.dataset.vfield;
  if (!field || !state.vpnProvider) return;
  state.vpnProvider[field] = e.target.value;
  renderOutput();
});

document.getElementById('client-list').addEventListener('click', async (e) => {
  const btn = e.target.closest && e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'remove-client') {
    const idx = +btn.dataset.idx;
    state.clients.splice(idx, 1);
    fullRender();
  } else if (action === 'gen-client') {
    const idx = +btn.dataset.idx;
    btn.disabled = true;
    try {
      const kp = await generateKeypair();
      state.clients[idx].priv = kp.private;
      state.clients[idx].pub = kp.public;
      fullRender();
    } catch (err) {
      console.error(err);
      btn.disabled = false;
    }
  }
});

document.getElementById('client-list').addEventListener('input', async (e) => {
  const field = e.target.dataset.cfield;
  if (!field) return;
  const idx = +e.target.dataset.idx;
  state.clients[idx][field] = e.target.value;
  renderOutput();
  if (field === 'priv') {
    const startVal = e.target.value;
    const pub = await derivePub(startVal);
    if (pub && state.clients[idx] && state.clients[idx].priv === startVal) {
      state.clients[idx].pub = pub;
      const pubInput = document.querySelector('input[data-cfield="pub"][data-idx="' + idx + '"]');
      if (pubInput) pubInput.value = pub;
      renderOutput();
    }
  }
});


document.getElementById('subnet').addEventListener('input', renderOutput);
document.getElementById('subnet6').addEventListener('input', renderOutput);
document.getElementById('keepalive').addEventListener('input', renderOutput);
document.getElementById('ipv6-mode').addEventListener('change', (e) => {
  const picker = document.getElementById('ipv6-picker');
  if (e.target.value === 'custom') {
    picker.classList.add('custom');
    const inp = document.getElementById('subnet6');
    if (!inp.value) inp.value = 'fd69:69:69::/64';
    inp.focus();
  } else {
    picker.classList.remove('custom');
  }
  renderOutput();
});

document.getElementById('dns-preset').addEventListener('change', (e) => {
  if (e.target.value === 'custom') {
    document.getElementById('dns-picker').classList.add('custom');
    const inp = document.getElementById('dns-custom');
    inp.focus();
  }
  renderOutput();
});
document.getElementById('dns-custom').addEventListener('input', renderOutput);

document.getElementById('mtu-mode').addEventListener('change', (e) => {
  if (e.target.value === 'custom') {
    const picker = document.getElementById('mtu-picker');
    picker.classList.add('custom');
    const mtu = document.getElementById('mtu');
    if (!mtu.value) mtu.value = String(recommendedMTU(state.servers.length));
    mtu.focus();
  }
  renderOutput();
});
document.getElementById('mtu').addEventListener('input', renderOutput);

document.addEventListener('click', (e) => {
  const back = e.target.closest && e.target.closest('button.back-btn');
  if (!back) return;
  const target = back.dataset.back;
  if (target === 'dns') {
    document.getElementById('dns-picker').classList.remove('custom');
    document.getElementById('dns-preset').value = '8.8.8.8';
    renderOutput();
  } else if (target === 'mtu') {
    document.getElementById('mtu-picker').classList.remove('custom');
    document.getElementById('mtu-mode').value = 'auto';
    renderOutput();
  } else if (target === 'ipv6') {
    document.getElementById('ipv6-picker').classList.remove('custom');
    document.getElementById('ipv6-mode').value = 'fd69:69:69::/64';
    renderOutput();
  }
});

document.getElementById('output').addEventListener('click', (e) => {
  if (!e.target.closest) return;
  const cb = e.target.closest('.code-block');
  if (!cb) return;
  const code = cb.querySelector('code').textContent;

  const dlBtn = e.target.closest('button.download');
  if (dlBtn) {
    const filename = dlBtn.dataset.filename || 'config.conf';
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return;
  }

  const copyBtn = e.target.closest('button.copy');
  if (!copyBtn) return;
  navigator.clipboard.writeText(code).then(() => {
    copyBtn.textContent = 'COPIED';
    copyBtn.classList.add('copied');
    setTimeout(() => {
      copyBtn.textContent = 'COPY';
      copyBtn.classList.remove('copied');
    }, 1200);
  }).catch(() => {
    copyBtn.textContent = 'FAILED';
    setTimeout(() => { copyBtn.textContent = 'COPY'; }, 1500);
  });
});

(async () => {
  const ok = await checkWebCrypto();
  document.querySelectorAll('button.back-btn').forEach(btn => {
    if (!btn.firstChild) btn.appendChild(chevronDownIcon());
  });
  state.clients.push(makeClient());
  state.servers.push(makeServer());
  // Client list and server list are pre-rendered in HTML for initial state — skip
  // re-rendering them here to avoid a flash of empty divs / layout shift.
  renderVpnProvider();
  renderOutput();
  if (!ok) {
    document.getElementById('webcrypto-error').classList.remove('hidden');
    document.querySelectorAll('button.wg-red, button.dark-gray').forEach(b => b.disabled = true);
  }
})();
