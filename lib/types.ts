export type Matter = { id: string; client: string; initials: string; caseName: string; caseNumber: string; court: string; caseType: string; status: "Active" | "Pending" | "Closed"; nextDate: string; color: string };

export const matters: Matter[] = [
  { id:"MAT-2025-0142", client:"Maria Rodriguez", initials:"MR", caseName:"Rodriguez v. Westfield Medical", caseNumber:"24-CV-00842", court:"Superior Court of California, County of Los Angeles", caseType:"Medical Malpractice", status:"Active", nextDate:"Aug 12", color:"#426b5c" },
  { id:"MAT-2025-0138", client:"James Chen", initials:"JC", caseName:"Chen v. Metro Development LLC", caseNumber:"2025-L-001298", court:"Circuit Court of Cook County, Illinois", caseType:"Breach of Contract", status:"Active", nextDate:"Aug 18", color:"#526c91" },
  { id:"MAT-2025-0129", client:"Olivia Brooks", initials:"OB", caseName:"In re Estate of William Brooks", caseNumber:"PR-2025-00471", court:"Probate Court of Fulton County, Georgia", caseType:"Probate", status:"Pending", nextDate:"Sep 03", color:"#9a714f" },
  { id:"MAT-2025-0117", client:"Daniel Okafor", initials:"DO", caseName:"Okafor v. Northline Logistics", caseNumber:"1:25-cv-00314", court:"U.S. District Court, Northern District of Georgia", caseType:"Employment", status:"Active", nextDate:"Sep 09", color:"#76547f" },
];
