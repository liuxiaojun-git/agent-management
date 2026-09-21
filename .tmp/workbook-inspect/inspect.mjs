import fs from 'node:fs/promises'
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool'

const inputPath = 'C:/Users/LXJ/Downloads/平台预交付配置清单_0728.xlsx'
const outputDir = 'E:/agent-management/.tmp/workbook-inspect/output'

const input = await FileBlob.load(inputPath)
const workbook = await SpreadsheetFile.importXlsx(input)

const summary = await workbook.inspect({
  kind: 'workbook,sheet,table',
  include: 'id,name,values,formulas',
  maxChars: 8000,
  tableMaxRows: 16,
  tableMaxCols: 12,
  tableMaxCellChars: 180,
})
console.log('SUMMARY')
console.log(summary.ndjson)

const firstSheet = workbook.worksheets.getItemAt(0)
const region = await workbook.inspect({
  kind: 'region',
  sheetId: firstSheet.name,
  range: 'A1:J15',
  include: 'values,formulas',
  maxChars: 12000,
})
console.log('REGION')
console.log(region.ndjson)

const styles = await workbook.inspect({
  kind: 'computedStyle',
  sheetId: firstSheet.name,
  range: 'A1:J15',
  maxChars: 6000,
})
console.log('STYLES')
console.log(styles.ndjson)

await fs.mkdir(outputDir, { recursive: true })
const preview = await workbook.render({
  sheetName: firstSheet.name,
  range: 'A1:J15',
  scale: 1.2,
  format: 'png',
})
await fs.writeFile(`${outputDir}/first-sheet.png`, new Uint8Array(await preview.arrayBuffer()))
console.log(`PREVIEW=${outputDir}/first-sheet.png`)
