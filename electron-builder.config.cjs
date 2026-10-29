module.exports = {
  appId: 'com.yogurt.manager',
  productName: 'Yogurt Manager',
  electronVersion: '45.1.0',
  directories: { app: 'build/desktop/shell', output: 'dist-desktop' },
  files: ['package.json', 'desktop/*.cjs', '!**/node_modules{,/**/*}'],
  // Keep node_modules below a named directory: builder excludes a file-set's root node_modules.
  extraResources: [{ from: 'build/desktop', to: '.', filter: ['backend/**/*'] }],
  asar: true,
  npmRebuild: false,
  forceCodeSigning: false,
  mac: {
    target: [{ target: 'dmg', arch: ['arm64'] }],
    category: 'public.app-category.business',
    icon: 'build/desktop/icon.icns',
    identity: null,
    hardenedRuntime: false,
    gatekeeperAssess: false,
  },
  dmg: { title: 'Yogurt Manager', sign: false },
  publish: null,
};
