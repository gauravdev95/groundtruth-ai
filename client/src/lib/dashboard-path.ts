// Where a freshly authenticated user belongs.
//
// Phase 2: the student dashboard exists at /student/dashboard, so
// candidates land there. Phase 3: the recruiter dashboard exists at
// /recruiter/dashboard, so recruiters land there.
export function dashboardPathForRole(role: string): string {
  switch (role) {
    case "candidate":
      return "/student/dashboard";
    case "recruiter":
      return "/recruiter/dashboard";
    default:
      return "/";
  }
}
