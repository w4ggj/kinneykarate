/**
 * 301 redirect map — old WordPress slugs → new Astro routes.
 * Extend this list before DNS cutover to protect SEO on kinneykarate.com.
 * Joe: review and add any slugs not listed here.
 */
export const redirects: Record<string, string> = {
  '/our-story/': '/about#story',
  '/our-story': '/about#story',
  '/our-instructors/': '/about#instructors',
  '/our-instructors': '/about#instructors',
  '/contact/': '/about#contact',
  '/contact': '/about#contact',
  '/new-student-information/': '/students#new',
  '/new-student-information': '/students#new',
  '/student-login/': '/students',
  '/student-login': '/students',
  '/programs/tang-soo-do/': '/programs#tang-soo-do',
  '/programs/tang-soo-do': '/programs#tang-soo-do',
  '/programs/aikido/': '/programs#aikido',
  '/programs/aikido': '/programs#aikido',
  '/programs/ju-jitsu/': '/programs#ju-jitsu',
  '/programs/ju-jitsu': '/programs#ju-jitsu',
  '/programs/modern-arnis/': '/programs#arnis',
  '/programs/modern-arnis': '/programs#arnis',
  '/locations/': '/locations',
  '/schedule/': '/locations',
  '/schedule': '/locations',
  '/shop/': '/store',
  '/shop': '/store',
  '/events/': '/events',
  '/news/': '/news',
  '/blog/': '/news',
  '/blog': '/news',
  // Business directory — out of scope v1
  '/business-directory/': '/about',
  '/submit-listing/': '/about',
};
