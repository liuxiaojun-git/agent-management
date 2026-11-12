import fs from 'node:fs/promises'
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool'

const inputPath = 'C:/Users/LXJ/Downloads/平台预交付配置清单_0728.xlsx'
const outputDir = 'E:/agent-management/.tmp/workbook-inspect/rendered'
const sheetNames = ['方案一各平台配置', '方案一的合计', '方案二各平台配置', '方案二的合计']
const outputNames = ['plan-1-config', 'plan-1-total', 'plan-2-config', 'plan-2-total']

const input = await FileBlob.load(inputPath)
const workbook = await SpreadsheetFile.importXlsx(input)
await fs.mkdir(outputDir, { recursive: true })

for (let index = 0; index < sheetNames.length; index += 1) {
  const preview = await workbook.render({
    sheetName: sheetNames[index],
    autoCrop: 'all',
    scale: 1.2,
    format: 'png',
  })
  await fs.writeFile(`${outputDir}/${outputNames[index]}.png`, new Uint8Array(await preview.arrayBuffer()))
  console.log(`${sheetNames[index]}=${outputDir}/${outputNames[index]}.png`)
}
