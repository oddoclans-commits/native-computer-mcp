# Feature Matrix

| Capability | Core contract | Windows | macOS | Linux |
| --- | --- | --- | --- | --- |
| screenshot | yes | native | planned | native X11 |
| OCR | optional | planned | planned | planned |
| accessibility tree | optional | planned UIA | planned AX | planned AT-SPI |
| native mouse/keyboard | yes | native Win32 | planned | native X11 |
| window discovery | yes | native Win32/.NET | planned | native wmctrl |
| dialogs | yes | planned | planned | planned |
| browser surface | planned | adapter | adapter | adapter |
| stale observation guard | yes | yes | yes | yes |
| session persistence | yes | yes | yes | yes |
| verification | yes | explicit fresh-observe gate | explicit fresh-observe gate | explicit fresh-observe gate |

The matrix describes the protocol boundary and current implementation maturity.
