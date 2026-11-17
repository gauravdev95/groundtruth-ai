// Where a freshly authenticated user belongs.
//
// Phase 1: the role dashboards (/student/dashboard, /recruiter/dashboard)
// do not exist yet — they land in a later phase. Until then every role
// lands on /account, the protected profile page built in this phase.
// When the dashboards land, change the two returns below and nothing else.
export function dashboardPathForRole(role: string): string {
  switch (role) {
    case "candidate":
      return "/account"; // TODO (Phase 2): "/student/dashboard"
    case "recruiter":
      return "/account"; // TODO (Phase 2): "/recruiter/dashboard"
    default:
      return "/";
  }
}
