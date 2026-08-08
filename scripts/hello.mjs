export default async function hello(args, { configDir }) {
  console.log(`hello from toolbox (configDir: ${configDir})`)
  if (args.length > 0) {
    console.log(`args: ${args.join(" ")}`)
  }
}
