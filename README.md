# wgcompose

WireGuard config generator supporting multiple clients and cascading servers (forwarding WireGuard connections from one server to another) and single-server setups. No backend needed, all code is run client-side in the browser including keypair generation.

<video src="https://github.com/user-attachments/assets/00a2496c-0aec-464b-8ede-879f991a398c" autoplay muted loop playsinline width="800"></video>

## Motivation and use cases

I built this tool to quickly generate a cascading network of WireGuard servers that allow me to either improve connections in suboptimal peering conditions by internet providers and circumvent internet censorship by connecting to a local server and utilising uncensored server-to-server connections resulting in such a cascaded network: Client -> Local Server -> Foreign Server -> ProtonVPN.

## Features

* JavaScript client-side generation of keypairs using WebCrypto X25519
* Simple client-to-server connections or multi-client and multi-server cascading connections
* Allow for exit node to be an external WireGuard provider such as ProtonVPN or Mullvad VPN
* Select IPv4 and IPv6 subnet, DNS servers, MTU and keepalive values
* Automatic configuration of optimal MTU
* Protection against leaks using client and server-side kill-switch enabled by default

## Usage:

Open `index.html` or https://rdke.dev/wpcompose in a modern browser
