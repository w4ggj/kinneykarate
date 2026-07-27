// Custom config plugin that replaces @stripe/stripe-terminal-react-native's
// broken auto-registered plugin. The beta package's plugin crashes Android
// prebuild by accessing appDelegate (iOS-only) unconditionally.
// All necessary permissions/entitlements are already declared in app.json directly.
const { withPlugins } = require('@expo/config-plugins');

// No-op plugin — permissions are set directly in app.json android.permissions
// and ios.entitlements. This plugin exists only to satisfy the auto-link resolver
// so it doesn't fall through to the broken beta plugin.
module.exports = (config) => withPlugins(config, []);
