# AirGap v2 - Ultra High-Speed Offline File Transfer

[![AirGap v2 CI](https://github.com/yourusername/airgap-v2/actions/workflows/ci.yml/badge.svg)](https://github.com/yourusername/airgap-v2/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**AirGap v2** is a professional-grade, browser-based secure file transfer application designed for maximum performance in completely offline environments. It leverages cutting-edge QR technology and 2026 standards to achieve unprecedented data transmission speeds without any network connectivity.

## 🚀 Key Features (2026 Edition)

- **High-Density Binary Protocol**: Built on RFC 9285 (Base45), increasing QR data capacity by **29%** over traditional methods.
- **Canvas-Powered 60 FPS Rendering**: Smooth, high-speed QR transmission that eliminates UI bottlenecks.
- **Dual-QR Throughput**: Support for side-by-side QR codes, doubling the effective bandwidth.
- **Adaptive Throughput Control**: Automatically scales transmission speed to match the receiver's hardware capabilities.
- **Zero-Trust Security**: End-to-end AES-256-GCM encryption with CRC32 integrity verification.
- **PWA Excellence**: Fully functional offline with 100% local processing.

## 🛠️ Technology Stack

- **Framework**: React 19 (Actions, useOptimistic)
- **Build System**: Vite 7
- **Styling**: Tailwind CSS 4.0 (CSS-first architecture)
- **Cryptography**: Web Crypto API (AES-GCM)
- **Protocol**: Custom Binary + Base45 + Zstd-ready
- **Testing**: Vitest 4.0 & Playwright 1.50

## 📦 Protocol Specification

AirGap v2 uses a specialized binary packet structure to minimize overhead:

```text
[Magic: 2B] [Type: 1B] [Sequence: 4B] [Timestamp: 8B] [Length: 2B] [Payload: NB]
```

Payloads are encoded using **Base45**, which is optimized for the QR Alphanumeric mode ($45^3 > 256^2$), yielding ~97% encoding efficiency.

## 🚀 Getting Started

### Prerequisites

- Node.js 22.x or higher
- Modern browser with Camera access (Chrome/Edge/Safari)

### Installation

```bash
git clone https://github.com/yourusername/airgap-v2.git
cd airgap-v2
npm install --legacy-peer-deps
```

### Development

```bash
npm run dev
```

### Production Build

```bash
npm run build
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---
*Built for the next decade of secure, air-gapped data transfer.*
