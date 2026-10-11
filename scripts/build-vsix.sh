#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

EXT=extension
VERSION=$(python3 -c "import json;print(json.load(open('$EXT/package.json'))['version'])")
NAME=$(python3 -c "import json;print(json.load(open('$EXT/package.json'))['name'])")
PUBLISHER=$(python3 -c "import json;print(json.load(open('$EXT/package.json'))['publisher'])")
DISPLAY=$(python3 -c "import json,html;print(html.escape(json.load(open('$EXT/package.json'))['displayName']))")
DESC=$(python3 -c "import json,html;print(html.escape(json.load(open('$EXT/package.json'))['description']))")

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/extension" dist
cp "$EXT/package.json" "$EXT/package.nls.json" "$EXT/package.nls.ru.json" "$EXT/icon.png" "$STAGE/extension/"
cp -R "$EXT/src" "$EXT/media" "$STAGE/extension/"
cp LICENSE "$STAGE/extension/LICENSE"
cp "$EXT/README.md" "$STAGE/extension/README.md"

cat > "$STAGE/[Content_Types].xml" <<XML
<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".json" ContentType="application/json"/><Default Extension=".js" ContentType="application/javascript"/><Default Extension=".css" ContentType="text/css"/><Default Extension=".html" ContentType="text/html"/><Default Extension=".md" ContentType="text/markdown"/><Default Extension=".png" ContentType="image/png"/><Default Extension=".vsixmanifest" ContentType="text/xml"/><Default Extension="" ContentType="text/plain"/></Types>
XML

cat > "$STAGE/extension.vsixmanifest" <<XML
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="$NAME" Version="$VERSION" Publisher="$PUBLISHER"/>
    <DisplayName>$DISPLAY</DisplayName>
    <Description xml:space="preserve">$DESC</Description>
    <Tags>claude,claude code,usage,limits,tokens,status bar</Tags>
    <License>extension/LICENSE</License>
    <Icon>extension/icon.png</Icon>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/icon.png" Addressable="true"/>
  </Assets>
</PackageManifest>
XML

OUT="$PWD/dist/$NAME-$VERSION.vsix"
rm -f "$OUT"
(cd "$STAGE" && zip -qrXD "$OUT" '[Content_Types].xml' extension.vsixmanifest extension)
echo "built $OUT"
