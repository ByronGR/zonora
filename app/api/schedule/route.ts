import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    candidate_name,
    candidate_email,
    meeting_link,
    scheduled_at,
    job_title,
    job_description,
    custom_questions,
  } = body

  const supabase = createServerClient()

  const { data: interview, error } = await supabase
    .from('interviews')
    .insert([{
      candidate_name,
      candidate_email,
      meeting_link,
      scheduled_at,
      job_title: job_title || null,
      job_description: job_description || null,
      custom_questions: custom_questions || [],
    }])
    .select()
    .single()

  if (error) {
    console.error('Supabase error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const recallRes = await fetch('https://us-west-2.recall.ai/api/v1/bot/', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${process.env.RECALL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      meeting_url: meeting_link,
      bot_name: 'Zonora',
      join_at: new Date(scheduled_at).toISOString(),
      real_time_transcription: {
        destination_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://zonora.vercel.app'}/api/webhook/recall`,
        partial_results: false,
      },
      status_change_webhook: {
        url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://zonora.vercel.app'}/api/webhook/recall`,
      },
      automatic_leave: {
        waiting_room_timeout: 300,   // leave if no one joins in 5 min
        everyone_left_timeout: 30,   // leave 30s after everyone else leaves
      },
    }),
  })

  const recallData = await recallRes.json()

  if (!recallRes.ok) {
    console.error('Recall.ai error:', recallData)
    return NextResponse.json({ error: 'Recall.ai error', details: recallData }, { status: 500 })
  }

  await supabase
    .from('interviews')
    .update({ recall_bot_id: recallData.id, bot_status: 'scheduled' })
    .eq('id', interview.id)

  return NextResponse.json({ success: true, interview, bot: recallData })
}
