/** CSS Modules class-map typing for the client bundle. */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
