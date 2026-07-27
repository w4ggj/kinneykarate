// Replaces the broken @stripe/stripe-terminal-react-native Expo config plugin
// with a no-op. The package's plugin crashes Android prebuild by accessing
// iOS-only appDelegate unconditionally. All required permissions are declared
// directly in app.json (android.permissions, ios.entitlements, ios.infoPlist).
const fs = require('fs');
const path = require('path');

const pluginPath = path.join(
  __dirname,
  '..',
  'node_modules',
  '@stripe',
  'stripe-terminal-react-native',
  'lib',
  'commonjs',
  'plugin',
  'withStripeTerminal.js'
);

if (fs.existsSync(pluginPath)) {
  fs.writeFileSync(pluginPath, 'module.exports = (config) => config;\n');
  console.log('[patch-stripe-plugin] Replaced broken plugin with no-op.');
} else {
  console.log('[patch-stripe-plugin] Plugin file not found, skipping.');
}
