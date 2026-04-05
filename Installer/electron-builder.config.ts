const config = {
  appId: "com.llmtoolkit.installer",
  productName: "LLM Toolkit Installer",
  directories: {
    output: "release",
    buildResources: "resources",
  },
  files: ["out/**/*", "package.json"],
  extraResources: [
    {
      from: "resources/payload",
      to: "payload",
    },
  ],
  win: {
    target: ["portable"],
    icon: "resources/icons/icon.ico",
    signAndEditExecutable: false,
  },
  mac: {
    target: ["dmg"],
  },
  linux: {
    target: ["AppImage"],
    icon: "resources/icons/icon.png",
    category: "Development",
  },
};

export default config;