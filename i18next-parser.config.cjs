module.exports = {
  locales: ["en", "zh", "zh-TW", "ja"],
  defaultNamespace: "translation",
  input: ["src/**/*.{ts,tsx}"],
  output: "src/i18n/locales/$LOCALE.json",
  keySeparator: ".",
  namespaceSeparator: false,
  defaultValue: (locale, _ns, key) => (locale === "en" ? key : ""),
  lexers: {
    ts: [{ lexer: "JavascriptLexer", functions: ["t"] }],
  },
};
