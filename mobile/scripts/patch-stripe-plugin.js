// Fixes the broken @stripe/stripe-terminal-react-native Expo config plugin.
// The plugin crashes Android prebuild by accessing iOS-only appDelegate
// unconditionally. We fix it two ways:
//   1. Remove "plugin" from expo-module.config.json so Expo never auto-registers it
//   2. Replace the plugin JS with a no-op as a belt-and-suspenders fallback
// All required permissions are declared directly in app.json.
const fs = require('fs');
const path = require('path');

const pkgRoot = path.join(
  __dirname,
  '..',
  'node_modules',
  '@stripe',
  'stripe-terminal-react-native'
);

// 1. Patch expo-module.config.json to remove the plugin auto-registration
const moduleConfigPath = path.join(pkgRoot, 'expo-module.config.json');
if (fs.existsSync(moduleConfigPath)) {
  try {
    const config = JSON.parse(fs.readFileSync(moduleConfigPath, 'utf8'));
    if (config.plugin) {
      delete config.plugin;
      fs.writeFileSync(moduleConfigPath, JSON.stringify(config, null, 2) + '\n');
      console.log('[patch-stripe-plugin] Removed plugin from expo-module.config.json');
    } else {
      console.log('[patch-stripe-plugin] expo-module.config.json already has no plugin field');
    }
  } catch (e) {
    console.error('[patch-stripe-plugin] Failed to patch expo-module.config.json:', e.message);
  }
} else {
  console.log('[patch-stripe-plugin] expo-module.config.json not found, skipping');
}

// 2. Remove minSdkVersion declaration from Stripe Terminal's AndroidManifest.xml
// so the Gradle manifest merger doesn't block builds when app minSdkVersion < 26
const manifestPath = path.join(
  pkgRoot,
  'android',
  'src',
  'main',
  'AndroidManifest.xml'
);
if (fs.existsSync(manifestPath)) {
  try {
    let content = fs.readFileSync(manifestPath, 'utf8');
    const before = content;
    // Remove self-closing <uses-sdk ... /> and block <uses-sdk>...</uses-sdk>
    content = content.replace(/<uses-sdk[^>]*\/>/g, '');
    content = content.replace(/<uses-sdk[^>]*>[\s\S]*?<\/uses-sdk>/g, '');
    if (content !== before) {
      fs.writeFileSync(manifestPath, content);
      console.log('[patch-stripe-plugin] Removed <uses-sdk> from Stripe Terminal AndroidManifest.xml');
    } else {
      console.log('[patch-stripe-plugin] No <uses-sdk> found in Stripe Terminal AndroidManifest.xml');
    }
  } catch (e) {
    console.error('[patch-stripe-plugin] Failed to patch AndroidManifest.xml:', e.message);
  }
} else {
  console.log('[patch-stripe-plugin] Stripe Terminal AndroidManifest.xml not found, skipping');
}

// 3. Also replace withStripeTerminal.js with a no-op
const pluginPath = path.join(
  pkgRoot,
  'lib',
  'commonjs',
  'plugin',
  'withStripeTerminal.js'
);
if (fs.existsSync(pluginPath)) {
  fs.writeFileSync(pluginPath, 'module.exports = (config) => config;\n');
  console.log('[patch-stripe-plugin] Replaced withStripeTerminal.js with no-op');
} else {
  console.log('[patch-stripe-plugin] withStripeTerminal.js not found, skipping');
}
