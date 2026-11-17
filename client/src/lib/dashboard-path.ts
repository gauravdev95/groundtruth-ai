// Where a freshly authenticated user belongs.
//
// Phase 2: the student dashboard exists at /student/dashboard, so
// candidates land there. The recruiter dashboard is still a later phase,
// so recruiters land on /account until then. When it lands, change the
// recruiter return below and nothing else.
export function dashboardPathForRole(role: string): string {
  switch (role) {
    case "candidate":
      return "/student/dashboard";
    case "recruiter":
      return "/account"; // TODO (later phase): "/recruiter/dashboard"
    default:
      return "/";
  }
}
