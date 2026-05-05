'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import Link from 'next/link'

type ConversationTurn = {
  role: 'bot' | 'candidate'
  content: string
  timestamp?: string
}

type Report = {
  cefr_level: string
  score: number
  fluency: string
  vocabulary: string
  grammar: string
  clarity: string
  strengths: string[]
  areas_for_improvement: string[]
  recommendation: string
  recommendation_reason: string
  summary: string
}

type Interview = {
  id: string
  candidate_name: string
  candidate_email: string
  meeting_link: string
  scheduled_at: string
  status: string
  bot_status: string | null
  recall_bot_id: string | null
  transcript: string | null
  conversation_history: ConversationTurn[] | null
  recording_url: string | null
  report: Report | null
  job_title: string | null
  job_description: string | null
}

const CEFR_COLOR: Record<string, { bg: string; text: string }> = {
  A1: { bg: 'bg-gray-100', text: 'text-gray-700' },
  A2: { bg: 'bg-gray-100', text: 'text-gray-700' },
  B1: { bg: 'bg-yellow-100', text: 'text-yellow-800' },
  B2: { bg: 'bg-blue-100', text: 'text-blue-800' },
  C1: { bg: 'bg-green-100', text: 'text-green-800' },
  C2: { bg: 'bg-purple-100', text: 'text-purple-800' },
}

function formatDate(str: string) {
  return new Date(str).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function StatusBadge({ interview }: { interview: Interview }) {
  const isPast = new Date(interview.scheduled_at) < new Date()
  const hasReport = !!interview.report

  if (hasReport) return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-700">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
      Report Ready
    </span>
  )
  if (isPast) return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
      Completed
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">
      <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
      Upcoming
    </span>
  )
}

export default function InterviewPage() {
  const params = useParams<{ id: string }>()
  const supabase = createClient()

  const [interview, setInterview] = useState<Interview | null>(null)
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  const [loadingInterview, setLoadingInterview] = useState(true)
  const [loadingRecording, setLoadingRecording] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'transcript' | 'details'>('transcript')
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    fetchInterview()
  }, [params.id])

  async function fetchInterview() {
    const { data, error } = await supabase
      .from('interviews')
      .select('*')
      .eq('id', params.id)
      .single()

    if (error || !data) {
      setError('Interview not found')
    } else {
      setInterview(data)
      fetchRecording()
    }
    setLoadingInterview(false)
  }

  async function fetchRecording() {
    setLoadingRecording(true)
    try {
      const res = await fetch(`/api/interview/${params.id}`)
      const data = await res.json()
      if (data.recording_url) setRecordingUrl(data.recording_url)
    } catch {
      // recording not available yet
    }
    setLoadingRecording(false)
  }

  async function handleGenerateReport() {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch(`/api/report/${params.id}`, { method: 'POST' })
      const text = await res.text()
      const data = text ? JSON.parse(text) : {}
      if (!res.ok) {
        setError(data.error || 'Failed to generate report')
      } else {
        await fetchInterview()
      }
    } catch (err) {
      setError('Error: ' + err)
    }
    setGenerating(false)
  }

  if (loadingInterview) {
    return (
      <main className="min-h-screen bg-[#0f1117] flex items-center justify-center">
        <p className="text-gray-500 text-sm">Loading...</p>
      </main>
    )
  }

  if (!interview) {
    return (
      <main className="min-h-screen bg-[#0f1117] flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error || 'Interview not found'}</p>
          <Link href="/dashboard" className="text-blue-400 hover:underline text-sm">← Back to dashboard</Link>
        </div>
      </main>
    )
  }

  const isPast = new Date(interview.scheduled_at) < new Date()
  const report = interview.report
  const cefrColors = report ? (CEFR_COLOR[report.cefr_level] || { bg: 'bg-gray-700', text: 'text-gray-200' }) : null

  const transcript: ConversationTurn[] = interview.conversation_history?.length
    ? interview.conversation_history
    : interview.transcript
      ? [{ role: 'candidate', content: interview.transcript }]
      : []

  return (
    <main className="min-h-screen bg-[#0f1117] text-gray-100">
      {/* Top nav */}
      <nav className="border-b border-white/10 px-6 py-3 flex items-center gap-4">
        <Link href="/dashboard" className="text-gray-400 hover:text-gray-200 transition">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-white">Zonora</span>
        </div>
        <span className="text-gray-600">/</span>
        <span className="text-sm text-gray-400">Interviews</span>
        <span className="text-gray-600">/</span>
        <span className="text-sm text-gray-300 font-medium">{interview.candidate_name}</span>
      </nav>

      {/* Status bar */}
      <div className="border-b border-white/10 px-6 py-3 flex items-center justify-between bg-white/[0.02]">
        <div className="flex items-center gap-4">
          <StatusBadge interview={interview} />
          {interview.job_title && (
            <span className="text-xs text-gray-500 border border-white/10 px-2.5 py-1 rounded-full">
              {interview.job_title}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>Joined {formatDate(interview.scheduled_at)}</span>
          {report && (
            <span className={`font-bold px-2 py-0.5 rounded ${cefrColors?.bg} ${cefrColors?.text}`}>
              {report.cefr_level}
            </span>
          )}
        </div>
      </div>

      <div className="flex h-[calc(100vh-97px)]">
        {/* Left panel — video + transcript */}
        <div className="flex-1 flex flex-col border-r border-white/10 overflow-hidden">
          {/* Video player */}
          <div className="bg-black flex items-center justify-center" style={{ height: '280px' }}>
            {loadingRecording ? (
              <p className="text-gray-600 text-sm">Loading recording...</p>
            ) : recordingUrl ? (
              <video
                ref={videoRef}
                src={recordingUrl}
                controls
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="text-center">
                <svg className="w-10 h-10 text-gray-700 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                </svg>
                <p className="text-gray-600 text-xs">
                  {isPast ? 'Recording not available' : 'Recording will appear after the interview'}
                </p>
              </div>
            )}
          </div>

          {/* Transcript tabs */}
          <div className="border-b border-white/10 px-4 flex gap-4">
            {(['transcript', 'details'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-2.5 text-xs font-medium border-b-2 transition capitalize ${
                  activeTab === tab
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                {tab === 'transcript' ? 'Transcript' : 'Interview Details'}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'transcript' ? (
              transcript.length > 0 ? (
                <div className="space-y-4">
                  {transcript.map((turn, i) => (
                    <div key={i} className={`flex gap-3 ${turn.role === 'bot' ? '' : 'flex-row-reverse'}`}>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                        turn.role === 'bot'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-700 text-gray-300'
                      }`}>
                        {turn.role === 'bot' ? 'Z' : interview.candidate_name[0].toUpperCase()}
                      </div>
                      <div className={`max-w-[80%] ${turn.role === 'bot' ? '' : 'items-end flex flex-col'}`}>
                        <p className={`text-xs font-medium mb-1 ${turn.role === 'bot' ? 'text-blue-400' : 'text-gray-400'}`}>
                          {turn.role === 'bot' ? 'Zonora' : interview.candidate_name}
                          {turn.timestamp && (
                            <span className="text-gray-600 font-normal ml-2">
                              {new Date(turn.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                          )}
                        </p>
                        <p className={`text-sm leading-relaxed px-3 py-2 rounded-lg ${
                          turn.role === 'bot'
                            ? 'bg-white/5 text-gray-200'
                            : 'bg-blue-600/20 text-gray-200'
                        }`}>
                          {turn.content}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <p className="text-gray-600 text-sm">
                    {isPast ? 'No transcript available.' : 'Transcript will appear here during and after the interview.'}
                  </p>
                </div>
              )
            ) : (
              <div className="space-y-3 text-sm">
                {[
                  { label: 'Candidate', value: interview.candidate_name },
                  { label: 'Email', value: interview.candidate_email },
                  { label: 'Meeting', value: interview.meeting_link },
                  { label: 'Scheduled', value: formatDate(interview.scheduled_at) },
                  { label: 'Job Title', value: interview.job_title || '—' },
                  { label: 'Bot ID', value: interview.recall_bot_id || '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="flex gap-3 py-2 border-b border-white/5">
                    <span className="text-gray-500 w-24 shrink-0">{label}</span>
                    <span className="text-gray-200 break-all">{value}</span>
                  </div>
                ))}
                {interview.job_description && (
                  <div className="py-2">
                    <p className="text-gray-500 mb-2">Job Description</p>
                    <p className="text-gray-300 text-xs leading-relaxed whitespace-pre-wrap">{interview.job_description}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right panel — report */}
        <div className="w-96 flex flex-col overflow-y-auto">
          {report ? (
            <div className="p-5 space-y-4">
              {/* Score header */}
              <div className={`rounded-xl p-4 ${
                report.recommendation === 'move_forward'
                  ? 'bg-green-900/30 border border-green-700/40'
                  : 'bg-red-900/30 border border-red-700/40'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-2xl font-bold ${cefrColors?.text}`}>{report.cefr_level}</span>
                    <span className="text-gray-400 text-sm">· {report.score}/100</span>
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                    report.recommendation === 'move_forward'
                      ? 'bg-green-600 text-white'
                      : 'bg-red-600 text-white'
                  }`}>
                    {report.recommendation === 'move_forward' ? 'Move Forward' : 'Do Not Move Forward'}
                  </span>
                </div>
                <p className="text-gray-300 text-xs leading-relaxed">{report.summary}</p>
              </div>

              {/* Recommendation reason */}
              <div className="bg-white/5 rounded-lg p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Assessment</p>
                <p className="text-gray-300 text-xs leading-relaxed">{report.recommendation_reason}</p>
              </div>

              {/* Skills */}
              <div className="bg-white/5 rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 border-b border-white/10">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Language Skills</p>
                </div>
                {[
                  { label: 'Fluency', value: report.fluency },
                  { label: 'Vocabulary', value: report.vocabulary },
                  { label: 'Grammar', value: report.grammar },
                  { label: 'Clarity', value: report.clarity },
                ].map(item => (
                  <div key={item.label} className="px-4 py-3 border-b border-white/5 last:border-0">
                    <p className="text-xs font-medium text-gray-400 mb-1">{item.label}</p>
                    <p className="text-xs text-gray-300 leading-relaxed">{item.value}</p>
                  </div>
                ))}
              </div>

              {/* Strengths */}
              <div className="bg-white/5 rounded-lg p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Strengths</p>
                <ul className="space-y-2">
                  {report.strengths.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-gray-300">
                      <span className="text-green-400 shrink-0 mt-0.5">✓</span>{s}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Areas for improvement */}
              <div className="bg-white/5 rounded-lg p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Areas for Improvement</p>
                <ul className="space-y-2">
                  {report.areas_for_improvement.map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-gray-300">
                      <span className="text-orange-400 shrink-0 mt-0.5">→</span>{a}
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-xs text-gray-600 text-center pt-2">Zonora · Powered by Nearwork</p>
            </div>
          ) : (
            <div className="p-5 flex flex-col items-center justify-center h-full text-center">
              {isPast ? (
                <>
                  <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-4">
                    <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
                    </svg>
                  </div>
                  <p className="text-gray-400 text-sm font-medium mb-1">No report yet</p>
                  <p className="text-gray-600 text-xs mb-5">Generate a CEFR + job fit evaluation from the recording.</p>
                  {error && <p className="text-red-400 text-xs mb-4">{error}</p>}
                  <button
                    onClick={handleGenerateReport}
                    disabled={generating}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition disabled:opacity-50"
                  >
                    {generating ? 'Generating…' : 'Generate Report'}
                  </button>
                  {generating && (
                    <p className="text-gray-600 text-xs mt-3">This takes about 60 seconds</p>
                  )}
                </>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-full bg-blue-600/10 flex items-center justify-center mb-4">
                    <svg className="w-6 h-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-gray-400 text-sm font-medium mb-1">Interview upcoming</p>
                  <p className="text-gray-600 text-xs">The report will be generated after the interview completes.</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
