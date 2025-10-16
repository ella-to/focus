/** @type {import("prettier").Options} */
const config = {
  bracketSpacing: true,
  jsxBracketSameLine: true,
  singleQuote: true,
  trailingComma: 'all',
  semi: false,
  arrowParens: 'avoid',
  printWidth: 120,
  tabWidth: 2,
  importOrder: ['^react$', '', '^react-router$', '@mantine/(.*)$', '', '^~/(.*)$', '', '^[./]'],
  // importOrderSeparation: true,
  // importOrderSortSpecifiers: true,
  plugins: ['@ianvs/prettier-plugin-sort-imports'],
}

export default config
