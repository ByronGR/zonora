import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  const supabase = createServerClient()

  const { data: interview, error } = await supabase
    .from('interviews')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !interview) {
    return NextResponse.json({ error: 'Interview not found' }, { status: 404 })
  }

  // Already have recording URL cached
  if (interview.recording_url) {
    return NextResponse.json({ recording_url: interview.recording_url })
  }

  // No bot yet
  if (!interview.recall_bot_id) {
    return NextResponse.json({ recording_url: null })
  }

  // Fetch from Recall.ai
  const botRes = await fetch(`https://us-west-2.recall.ai/api/v1/bot/${interview.recall_bot_id}/`, {
    headers: { 'Authorization': `Token ${process.env.RECALL_API_KEY}` },
  })

  if (!botRes.ok) {
    return NextResponse.json({ recording_url: null })
  }

  const botData = await botRes.json()
  const recording_url =
    botData?.video_url ||
    botData?.recordings?.[0]?.media_shortcuts?.video_mixed?.data?.download_url ||
    null

  if (recording_url) {
    await supabase
      .from('interviews')
      .update({ recording_url })
      .eq('id', id)
  }

  return NextResponse.json({ recording_url })
}
