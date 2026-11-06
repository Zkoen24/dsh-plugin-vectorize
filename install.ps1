# Install the vectorize plugin into a dsh profile.
#
#   .\install.ps1                       # default profile: desktop
#   .\install.ps1 -Profile web          # another profile
#   .\install.ps1 -DshHome D:\.dsh      # non-default dsh home
#
# Copies the compiled plugin into <dsh home>\profiles\node_modules, adds the
# loader entry to the profile's cordis.patch.yml (backed up first), and runs a
# smoke test that registers the tool. Restart dsh afterwards.

param(
    [string]$Profile = 'desktop',
    [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh')
)

$ErrorActionPreference = 'Stop'

$profiles = Join-Path $DshHome 'profiles'
if (-not (Test-Path $profiles)) {
    throw "dsh profiles directory not found: $profiles"
}

$patch = Join-Path $profiles "$Profile\cordis.patch.yml"
if (-not (Test-Path $patch)) {
    $available = (Get-ChildItem $profiles -Directory | Select-Object -ExpandProperty Name) -join ', '
    throw "profile '$Profile' not found (existing: $available)"
}

# 1. copy the plugin package
$target = Join-Path $profiles 'node_modules\@deepseek-ai\dsh-plugin-vectorize'
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'lib') $target -Recurse -Force
foreach ($file in 'package.json', 'README.md', 'cordis.patch.yml') {
    Copy-Item (Join-Path $PSScriptRoot $file) $target -Force
}
Write-Host "installed -> $target"

# 2. register it in the profile's user patch layer
$utf8 = New-Object System.Text.UTF8Encoding($false)
$text = [System.IO.File]::ReadAllText($patch, $utf8)
if ($text -match 'dsh-plugin-vectorize') {
    Write-Host "patch already registers the plugin: $patch"
} else {
    $backup = "$patch.bak-$(Get-Date -Format yyyyMMddHHmmss)"
    Copy-Item $patch $backup -Force
    $entry = "`n# Raster -> vector tool (vectorize_image).`n- insert:`n    - id: vectorize`n      name: '@deepseek-ai/dsh-plugin-vectorize'`n"
    [System.IO.File]::WriteAllText($patch, $text.TrimEnd() + $entry, $utf8)
    Write-Host "patched -> $patch (backup: $backup)"
}

# 3. the two runtime dependencies must exist in the profile
foreach ($dep in 'sharp', '@deepseek-ai\dsh-tools') {
    if (-not (Test-Path (Join-Path $profiles "node_modules\$dep"))) {
        Write-Warning "missing dependency '$dep' under $profiles\node_modules; the plugin will fail to load"
    }
}

# 4. smoke test: import the installed copy and register the tool.
# The probe must live inside the profile so Node resolves the package through
# the profile's node_modules (bare specifiers resolve from the importing file).
$probe = Join-Path $profiles "$Profile\.dsh-vectorize-probe.mjs"
@'
const m = await import('@deepseek-ai/dsh-plugin-vectorize')
const registered = []
m.apply({ tools: { register: (d) => { registered.push(d); return () => {} } } })
console.log('smoke test OK:', registered[0]?.name)
'@ | Set-Content -Path $probe -Encoding UTF8
Push-Location (Join-Path $profiles $Profile)
try {
    node $probe
} finally {
    Pop-Location
    Remove-Item $probe -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'Restart dsh, then ask: "vectorize E:/pics/logo.png to both svg and ai, 4 colors".'
