// Vite 的 ?raw 后缀导入：vitest 里拿 CSS 源文本做静态合同测试（styles.test.ts）。
// TypeScript 本体不识别该后缀，这里补模块声明，仅测试环境使用。
declare module "*?raw" {
  const content: string;
  export default content;
}
