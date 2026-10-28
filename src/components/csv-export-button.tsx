"use client";

import { csvCell, type CsvCellValue } from "@/lib/report-csv";

type Cell = CsvCellValue;
export function CsvExportButton({filename,headers,rows,label="CSV",className="button button-secondary"}:{filename:string;headers:string[];rows:Cell[][];label?:string;className?:string}){
  function download(){const cell=(value:Cell)=>csvCell(value,"plain");const lines=[headers.map(cell).join(","),...rows.map(row=>row.map(cell).join(","))];const blob=new Blob(["\uFEFF"+lines.join("\n")],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename.endsWith(".csv")?filename:`${filename}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)}
  return <button type="button" className={className} onClick={download}>ສົ່ງອອກ {label}</button>;
}
