// The route table (docs/architecture.md, "Screens"): one lazy import per screen.
// Features fill their screens; they never edit this file.
import type { QueryClient } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  type RouterHistory,
  redirect,
} from '@tanstack/react-router';
import { BareLayout, ErrorScreen, NotFoundScreen, PendingScreen, TabLayout } from './app/layouts';
import { isApiError } from './lib/api/errors';
import { isFirstRun, loadProfile } from './lib/auth/profile';
import type { AuthStore } from './lib/auth/store';

export interface RouterContext {
  queryClient: QueryClient;
  auth: AuthStore;
}

type GuardArgs = { context: RouterContext; location: { href: string } };

/** Sends signed out visitors to the login, remembering where they wanted to go. */
async function requireSignedIn({ context, location }: GuardArgs) {
  await context.auth.ready();
  if (!context.auth.session) {
    throw redirect({ to: '/login', search: { redirect: location.href } });
  }
}

/** The first run: a learner who has not finished onboarding goes there first. */
async function requireOnboarded(args: GuardArgs) {
  await requireSignedIn(args);
  try {
    const profile = await loadProfile(args.context.queryClient);
    if (profile && isFirstRun(profile)) throw redirect({ to: '/onboarding' });
  } catch (e) {
    if (isApiError(e) && e.status === 401) {
      throw redirect({ to: '/login', search: { redirect: args.location.href } });
    }
    throw e;
  }
}

/** Login and sign up are for signed out visitors only. */
async function redirectIfSignedIn({ context }: GuardArgs) {
  await context.auth.ready();
  if (context.auth.session) throw redirect({ to: '/' });
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFoundScreen,
  errorComponent: ErrorScreen,
  pendingComponent: PendingScreen,
});

// --- Tabs: signed in and past the first run ------------------------------------------------

const tabs = createRoute({
  getParentRoute: () => rootRoute,
  id: 'tabs',
  component: TabLayout,
  beforeLoad: requireOnboarded,
});

// Today
const todayRoute = createRoute({
  getParentRoute: () => tabs,
  path: '/',
  component: lazyRouteComponent(() => import('./features/today/TodayScreen'), 'TodayScreen'),
});
const settingsRoute = createRoute({
  getParentRoute: () => tabs,
  path: '/settings',
  component: lazyRouteComponent(() => import('./features/today/SettingsScreen'), 'SettingsScreen'),
});
const aboutRoute = createRoute({
  getParentRoute: () => tabs,
  path: '/settings/about',
  component: lazyRouteComponent(() => import('./features/today/AboutScreen'), 'AboutScreen'),
});

// Review
const reviewRoute = createRoute({
  getParentRoute: () => tabs,
  path: '/review',
  component: lazyRouteComponent(() => import('./features/review/ReviewScreen'), 'ReviewScreen'),
});
const deckRoute = createRoute({
  getParentRoute: () => tabs,
  path: '/deck',
  component: lazyRouteComponent(() => import('./features/review/DeckScreen'), 'DeckScreen'),
});
const noteRoute = createRoute({
  getParentRoute: () => tabs,
  path: '/deck/$noteId',
  component: lazyRouteComponent(() => import('./features/review/NoteScreen'), 'NoteScreen'),
});
const wordsRoute = createRoute({
  getParentRoute: () => tabs,
  path: '/words',
  component: lazyRouteComponent(() => import('./features/words/WordsScreen'), 'WordsScreen'),
});
const bandRoute = createRoute({
  getParentRoute: () => tabs,
  path: '/words/band/$band',
  component: lazyRouteComponent(() => import('./features/words/BandScreen'), 'BandScreen'),
});
const lemmaRoute = createRoute({
  getParentRoute: () => tabs,
  path: '/lemma/$lemmaId',
  component: lazyRouteComponent(() => import('./features/words/LemmaScreen'), 'LemmaScreen'),
});

// Read
const libraryRoute = createRoute({
  getParentRoute: () => tabs,
  path: '/read',
  component: lazyRouteComponent(() => import('./features/reader/LibraryScreen'), 'LibraryScreen'),
});
const importRoute = createRoute({
  getParentRoute: () => tabs,
  path: '/read/import',
  component: lazyRouteComponent(() => import('./features/reader/ImportScreen'), 'ImportScreen'),
});
const readerRoute = createRoute({
  getParentRoute: () => tabs,
  path: '/read/$textId',
  component: lazyRouteComponent(() => import('./features/reader/ReaderScreen'), 'ReaderScreen'),
});

// Cases
const courseRoute = createRoute({
  getParentRoute: () => tabs,
  path: '/cases',
  component: lazyRouteComponent(() => import('./features/cases/CourseScreen'), 'CourseScreen'),
});
const lessonRoute = createRoute({
  getParentRoute: () => tabs,
  path: '/cases/lesson/$lessonId',
  component: lazyRouteComponent(() => import('./features/cases/LessonScreen'), 'LessonScreen'),
});
const trainerRoute = createRoute({
  getParentRoute: () => tabs,
  path: '/cases/train',
  component: lazyRouteComponent(() => import('./features/cases/TrainerScreen'), 'TrainerScreen'),
});
const patternRoute = createRoute({
  getParentRoute: () => tabs,
  path: '/cases/pattern/$patternId',
  component: lazyRouteComponent(() => import('./features/cases/PatternScreen'), 'PatternScreen'),
});

// Tutor
const scenariosRoute = createRoute({
  getParentRoute: () => tabs,
  path: '/tutor',
  component: lazyRouteComponent(
    () => import('./features/tutor/ScenariosScreen'),
    'ScenariosScreen',
  ),
});
const chatRoute = createRoute({
  getParentRoute: () => tabs,
  path: '/tutor/$conversationId',
  component: lazyRouteComponent(() => import('./features/tutor/ChatScreen'), 'ChatScreen'),
});

// --- No tab: account screens and the first run --------------------------------------------

const bare = createRoute({
  getParentRoute: () => rootRoute,
  id: 'bare',
  component: BareLayout,
});

const loginRoute = createRoute({
  getParentRoute: () => bare,
  path: '/login',
  validateSearch: (s: Record<string, unknown>): { redirect?: string } =>
    typeof s.redirect === 'string' && s.redirect.startsWith('/') ? { redirect: s.redirect } : {},
  beforeLoad: redirectIfSignedIn,
  component: lazyRouteComponent(() => import('./features/account/LoginScreen'), 'LoginScreen'),
});
const signupRoute = createRoute({
  getParentRoute: () => bare,
  path: '/signup',
  beforeLoad: redirectIfSignedIn,
  component: lazyRouteComponent(() => import('./features/account/SignupScreen'), 'SignupScreen'),
});
const verifyRoute = createRoute({
  getParentRoute: () => bare,
  path: '/verify',
  component: lazyRouteComponent(() => import('./features/account/VerifyScreen'), 'VerifyScreen'),
});
const resetRoute = createRoute({
  getParentRoute: () => bare,
  path: '/reset',
  component: lazyRouteComponent(() => import('./features/account/ResetScreen'), 'ResetScreen'),
});

const firstRun = createRoute({
  getParentRoute: () => bare,
  id: 'first-run',
  beforeLoad: requireSignedIn,
});
const onboardingRoute = createRoute({
  getParentRoute: () => firstRun,
  path: '/onboarding',
  component: lazyRouteComponent(
    () => import('./features/account/OnboardingScreen'),
    'OnboardingScreen',
  ),
});
const placementRoute = createRoute({
  getParentRoute: () => firstRun,
  path: '/placement',
  component: lazyRouteComponent(
    () => import('./features/placement/PlacementScreen'),
    'PlacementScreen',
  ),
});

export const routeTree = rootRoute.addChildren([
  tabs.addChildren([
    todayRoute,
    settingsRoute,
    aboutRoute,
    reviewRoute,
    deckRoute,
    noteRoute,
    wordsRoute,
    bandRoute,
    lemmaRoute,
    libraryRoute,
    importRoute,
    readerRoute,
    courseRoute,
    lessonRoute,
    trainerRoute,
    patternRoute,
    scenariosRoute,
    chatRoute,
  ]),
  bare.addChildren([
    loginRoute,
    signupRoute,
    verifyRoute,
    resetRoute,
    firstRun.addChildren([onboardingRoute, placementRoute]),
  ]),
]);

/** Every path of the route table, for tests and the smoke run. */
export const ROUTE_PATHS = {
  tabs: [
    '/',
    '/settings',
    '/settings/about',
    '/review',
    '/deck',
    '/deck/$noteId',
    '/words',
    '/words/band/$band',
    '/lemma/$lemmaId',
    '/read',
    '/read/import',
    '/read/$textId',
    '/cases',
    '/cases/lesson/$lessonId',
    '/cases/train',
    '/cases/pattern/$patternId',
    '/tutor',
    '/tutor/$conversationId',
  ],
  bare: ['/login', '/signup', '/verify', '/reset', '/onboarding', '/placement'],
} as const;

export function createAppRouter(context: RouterContext, options: { history?: RouterHistory } = {}) {
  return createRouter({
    routeTree,
    context,
    defaultPreload: 'intent',
    // Query owns caching; the router only decides what to show.
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    ...(options.history ? { history: options.history } : {}),
  });
}

/** A router on an in-memory history, for tests. */
export function createTestRouter(context: RouterContext, initialPath = '/') {
  return createAppRouter(context, {
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
