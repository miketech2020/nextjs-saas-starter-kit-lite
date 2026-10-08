import { NextResponse, type NextRequest } from 'next/server';

import { createAuthCallbackService } from '@kit/supabase/auth';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import pathsConfig from '~/config/paths.config';

export async function GET(request: NextRequest) {
  const service = createAuthCallbackService(getSupabaseServerClient());

  const { nextPath } = await service.exchangeCodeForSession(request, {
    redirectPath: pathsConfig.app.home,
  });

  const response=NextResponse.redirect(new URL(nextPath,process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'));
  response.headers.set('Cache-Control','private, no-store, max-age=0');
  return response;
}
