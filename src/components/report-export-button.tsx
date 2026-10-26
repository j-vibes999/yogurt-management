"use client";

import { buildReportCsv, type ReportCsvContext, type ReportCsvRow, type ReportCsvSummary } from "@/lib/report-csv";

export function ReportExportButton({rows,period="month",summary,context}:{rows:ReportCsvRow[];period?:string;summary?:ReportCsvSummary;context?:ReportCsvContext}){
 function download(){const blob=new Blob([buildReportCsv(rows,summary,context)],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`yogurt-report-${period}-${new Date().toISOString().slice(0,10)}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)}
 return <div className="report-export-actions-v42"><button className="button button-secondary" type="button" onClick={()=>window.print()}>ພິມ / PDF</button><button className="button button-primary" type="button" onClick={download}>ສົ່ງອອກ CSV</button></div>;
}
