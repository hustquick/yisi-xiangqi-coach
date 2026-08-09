import AppKit
import CoreText

let arguments = CommandLine.arguments
guard arguments.count == 2 else {
    fatalError("Usage: swift make_app_icon.swift OUTPUT.png")
}

let size = NSSize(width: 1024, height: 1024)
guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: 1024,
    pixelsHigh: 1024,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
) else { fatalError("Could not create app icon bitmap") }
bitmap.size = size
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)

let canvas = NSRect(origin: .zero, size: size)
NSColor(calibratedRed: 0.67, green: 0.10, blue: 0.08, alpha: 1).setFill()
canvas.fill()

let inner = canvas.insetBy(dx: 106, dy: 106)
let innerPath = NSBezierPath(roundedRect: inner, xRadius: 154, yRadius: 154)
NSColor(calibratedRed: 0.94, green: 0.82, blue: 0.59, alpha: 1).setFill()
innerPath.fill()

let ring = NSBezierPath(ovalIn: inner.insetBy(dx: 82, dy: 82))
ring.lineWidth = 24
NSColor(calibratedRed: 0.67, green: 0.10, blue: 0.08, alpha: 1).setStroke()
ring.stroke()

// NSString's typographic rectangle includes asymmetric font side bearings,
// which made the visible glyph look off-center. Center the actual glyph path.
let font = CTFontCreateWithName("STKaiti" as CFString, 520, nil)
var characters = Array("象".utf16)
var glyphs = [CGGlyph](repeating: 0, count: characters.count)
guard CTFontGetGlyphsForCharacters(font, &characters, &glyphs, characters.count),
      let glyph = glyphs.first,
      let glyphPath = CTFontCreatePathForGlyph(font, glyph, nil)
else { fatalError("Could not create the icon glyph") }

let glyphBounds = glyphPath.boundingBoxOfPath
let context = NSGraphicsContext.current!.cgContext
context.saveGState()
context.translateBy(
    x: canvas.midX - glyphBounds.midX,
    y: canvas.midY - glyphBounds.midY
)
context.addPath(glyphPath)
context.setFillColor(NSColor(calibratedRed: 0.18, green: 0.17, blue: 0.12, alpha: 1).cgColor)
context.fillPath()
context.restoreGState()

NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Could not render app icon")
}

try png.write(to: URL(fileURLWithPath: arguments[1]))
