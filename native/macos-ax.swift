import Foundation
import AppKit
import ApplicationServices
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

struct Point: Codable {
    let x: Double
    let y: Double
}

struct Bounds: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct Request: Codable {
    let command: String
    let payload: Payload?
}

struct Payload: Codable {
    let type: String?
    let targetId: String?
    let point: Point?
    let button: String?
    let value: String?
    let from: Point?
    let to: Point?
}

func attribute(_ element: AXUIElement, _ name: String) -> Any? {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
    return error == .success ? value : nil
}

func stringAttribute(_ element: AXUIElement, _ name: String) -> String? {
    attribute(element, name) as? String
}

func boolAttribute(_ element: AXUIElement, _ name: String) -> Bool? {
    attribute(element, name) as? Bool
}

func boundsAttribute(_ element: AXUIElement) -> Bounds? {
    guard let rawValue = attribute(element, kAXPositionAttribute),
          let rawSizeValue = attribute(element, kAXSizeAttribute),
          let value = rawValue as? AXValue,
          let sizeValue = rawSizeValue as? AXValue else {
        return nil
    }

    var position = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(value, .cgPoint, &position),
          AXValueGetValue(sizeValue, .cgSize, &size) else {
        return nil
    }

    return Bounds(
        x: Double(position.x),
        y: Double(position.y),
        width: Double(size.width),
        height: Double(size.height)
    )
}

func childElements(_ element: AXUIElement) -> [AXUIElement] {
    (attribute(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []
}

var nodeCount = 0

func makeNode(_ element: AXUIElement, path: [Int], depth: Int, maxDepth: Int = 8) -> [String: Any] {
    nodeCount += 1

    var node: [String: Any] = [
        "id": "ax:" + path.map(String.init).joined(separator: "."),
        "role": stringAttribute(element, kAXRoleAttribute) ?? "unknown",
        "enabled": boolAttribute(element, kAXEnabledAttribute) ?? true
    ]

    if let title = stringAttribute(element, kAXTitleAttribute), !title.isEmpty {
        node["name"] = title
    } else if let description = stringAttribute(element, kAXDescriptionAttribute), !description.isEmpty {
        node["name"] = description
    }

    if let value = stringAttribute(element, kAXValueAttribute) {
        node["value"] = value
    }

    if let bounds = boundsAttribute(element) {
        node["bounds"] = [
            "x": bounds.x, "y": bounds.y,
            "width": bounds.width, "height": bounds.height
        ]
    }

    var actions: [String] = []
    var actionNames: CFArray?
    if AXUIElementCopyActionNames(element, &actionNames) == .success,
       let names = actionNames as? [String] {
        actions = Array(names.prefix(16))
    }
    if !actions.isEmpty {
        node["patterns"] = actions
    }

    if depth < maxDepth && nodeCount < 500 {
        let children = childElements(element)
        var childNodes: [[String: Any]] = []
        for (index, child) in children.prefix(100).enumerated() {
            if nodeCount >= 500 { break }
            childNodes.append(makeNode(child, path: path + [index], depth: depth + 1))
        }
        if !childNodes.isEmpty {
            node["children"] = childNodes
        }
    }

    return node
}

func resolve(_ root: AXUIElement, path: [Int]) throws -> AXUIElement {
    var element = root
    for index in path {
        let children = childElements(element)
        guard index >= 0 && index < children.count else {
            throw NSError(domain: "native-computer-mcp", code: 2, userInfo: [NSLocalizedDescriptionKey: "AX target path is stale."])
        }
        element = children[index]
    }
    return element
}

func frontmostApplication() throws -> NSRunningApplication {
    guard let app = NSWorkspace.shared.frontmostApplication else {
        throw NSError(domain: "native-computer-mcp", code: 1, userInfo: [NSLocalizedDescriptionKey: "No frontmost application."])
    }
    return app
}

func axRoot() throws -> AXUIElement {
    let app = try frontmostApplication()
    let root = AXUIElementCreateApplication(app.processIdentifier)

    if let rawWindow = attribute(root, kAXFocusedWindowAttribute),
       let window = rawWindow as? AXUIElement {
        return window
    }
    return root
}

func click(_ point: CGPoint, _ button: CGMouseButton) {
    let downType: CGEventType = button == .right ? .rightMouseDown : button == .center ? .otherMouseDown : .leftMouseDown
    let upType: CGEventType = button == .right ? .rightMouseUp : button == .center ? .otherMouseUp : .leftMouseUp
    let source = CGEventSource(stateID: .combinedSessionState)
    CGEvent(mouseEventSource: source, mouseType: downType, mouseCursorPosition: point, mouseButton: button)?.post(tap: .cghidEventTap)
    CGEvent(mouseEventSource: source, mouseType: upType, mouseCursorPosition: point, mouseButton: button)?.post(tap: .cghidEventTap)
}

func invoke(_ element: AXUIElement) throws {
    let error = AXUIElementPerformAction(element, kAXPressAction as CFString)
    if error != .success {
        guard let bounds = boundsAttribute(element) else {
            throw NSError(domain: "native-computer-mcp", code: Int(error.rawValue), userInfo: [NSLocalizedDescriptionKey: "AXPress failed."])
        }
        click(
            CGPoint(x: bounds.x + bounds.width / 2.0, y: bounds.y + bounds.height / 2.0),
            .left
        )
    }
}

func captureMainDisplay() -> [String: Any]? {
    guard let image = CGDisplayCreateImage(CGMainDisplayID()) else {
        return nil
    }

    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(
        data,
        UTType.png.identifier as CFString,
        1,
        nil
    ) else {
        return nil
    }

    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else {
        return nil
    }

    let encoded = (data as Data).base64EncodedString()
    return [
        "mimeType": "image/png",
        "data": encoded,
        "width": image.width,
        "height": image.height
    ]
}

func setValue(_ element: AXUIElement, _ value: String) throws {
    let error = AXUIElementSetAttributeValue(
        element,
        kAXValueAttribute as CFString,
        value as CFTypeRef
    )
    if error != .success {
        throw NSError(domain: "native-computer-mcp", code: Int(error.rawValue), userInfo: [NSLocalizedDescriptionKey: "AX value update failed."])
    }
}

func main(_ request: Request) throws -> [String: Any] {
    guard AXIsProcessTrusted() else {
        throw NSError(domain: "native-computer-mcp", code: 100, userInfo: [NSLocalizedDescriptionKey: "macOS Accessibility permission is not granted."])
    }

    let root = try axRoot()

    if request.command == "observe" {
        nodeCount = 0
        let app = try frontmostApplication()

        var result: [String: Any] = [
            "ok": true,
            "accessibility": [makeNode(root, path: [], depth: 0)],
            "capabilities": [
                "native_input",
                "ui_automation",
                "semantic_targets",
                "semantic_actions",
                "accessibility_ax",
                "screenshot"
            ]
        ]

        if let screenshot = captureMainDisplay() {
            result["screenshot"] = screenshot
        }

        result["activeWindow"] = [
            "id": String(root.hashValue),
            "title": (stringAttribute(root, kAXTitleAttribute) ?? ""),
            "appName": app.localizedName ?? ""
        ]

        return result
    }

    guard request.command == "act", let payload = request.payload else {
        throw NSError(domain: "native-computer-mcp", code: 3, userInfo: [NSLocalizedDescriptionKey: "Unsupported AX command."])
    }

    if let targetId = payload.targetId, targetId.hasPrefix("ax:") {
        let suffix = String(targetId.dropFirst(3))
        let path = suffix.isEmpty ? [] : suffix.split(separator: ".").compactMap { Int($0) }
        let element = try resolve(root, path: path)

        switch payload.type {
        case "click":
            if payload.button == "right" {
                guard let bounds = boundsAttribute(element) else { throw NSError(domain: "native-computer-mcp", code: 4, userInfo: [NSLocalizedDescriptionKey: "AX target has no bounds."]) }
                click(CGPoint(x: bounds.x + bounds.width / 2.0, y: bounds.y + bounds.height / 2.0), .right)
            } else {
                try invoke(element)
            }
        case "set_value":
            try setValue(element, payload.value ?? "")
        case "secondary_action":
            guard let bounds = boundsAttribute(element) else { throw NSError(domain: "native-computer-mcp", code: 5, userInfo: [NSLocalizedDescriptionKey: "AX target has no bounds."]) }
            click(CGPoint(x: bounds.x + bounds.width / 2.0, y: bounds.y + bounds.height / 2.0), .right)
        default:
            throw NSError(domain: "native-computer-mcp", code: 6, userInfo: [NSLocalizedDescriptionKey: "Unsupported AX semantic action."])
        }

        return ["ok": true]
    }

    if payload.type == "click", let point = payload.point {
        let button: CGMouseButton = payload.button == "right" ? .right : payload.button == "middle" ? .center : .left
        click(CGPoint(x: point.x, y: point.y), button)
        return ["ok": true]
    }

    throw NSError(domain: "native-computer-mcp", code: 7, userInfo: [NSLocalizedDescriptionKey: "Unsupported AX action."])
}

do {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    let request = try JSONDecoder().decode(Request.self, from: input)
    let response = try main(request)
    let data = try JSONSerialization.data(withJSONObject: response)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    let response: [String: Any] = ["ok": false, "message": error.localizedDescription]
    let data = try JSONSerialization.data(withJSONObject: response)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(1)
}
