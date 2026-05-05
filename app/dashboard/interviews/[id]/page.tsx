'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import Link from 'next/link'

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
  recall_bot_id: string | null
  transcript: string | null
  report: Report | null
}

const CEFR_COLORS: Record<string, string> = {
  A1: 'bg-gray-100 text-gray-700',
  A2: 'bg-gray-100 text-gray-700',
  B1: 'bg-yellow-100 text-yellow-800',
  B2: 'bg-blue-100 text-blue-800',
  C1: 'bg-green-100 text-green-800',
  C2: 'bg-purple-100 text-purple-800',
}

export default function InterviewReportPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [interview, setInterview] = useState<Interview | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    }
    setLoading(false)
  }

  async function handleGenerateReport() {
    if (!interview) return
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch(`/api/report/${interview.id}`, { method: 'POST' })
      const text = await res.text()
      const data = text ? JSON.parse(text) : {}

      if (!res.ok) {
        setError('Error generating report: ' + (data.error || JSON.stringify(data)))
      } else {
        await fetchInterview()
      }
    } catch (err) {
      setError('Error: ' + err)
    }
    setGenerating(false)
  }

  function formatDate(str: string) {
    return new Date(str).toLocaleString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading interview...</div>
      </main>
    )
  }

  if (error && !interview) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error}</p>
          <Link href="/dashboard" className="text-blue-600 hover:underline text-sm">← Back to dashboard</Link>
        </div>
      </main>
    )
  }

  if (!interview) return null

  const isPast = new Date(interview.scheduled_at) < new Date()
  const report = interview.report

  return (
    <main className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-gray-400 hover:text-gray-600 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <span className="font-bold text-gray-900">Zonora</span>
          </div>
        </div>
        <span className="text-sm text-gray-500">Interview Report</span>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{interview.candidate_name}</h1>
              <p className="text-gray-500 text-sm mt-0.5">{interview.candidate_email}</p>
              <p className="text-gray-400 text-xs mt-1">{formatDate(interview.scheduled_at)}</p>
            </div>
            {report && (
              <div className="flex items-center gap-3">
                <span className={`text-sm font-bold px-3 py-1.5 rounded-lg ${CEFR_COLORS[report.cefr_level] || 'bg-gray-100 text-gray-700'}`}>
                  {report.cefr_level}
                </span>
                <span className={`text-sm font-semibold px-3 py-1.5 rounded-lg ${
                  report.recommendation === 'move_forward' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
                }`}>
                  {report.recommendation === 'move_forward' ? 'Move Forward' : 'Do Not Move Forward'}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* No report yet */}
        {!report && isPast && (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center mb-6">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
              </svg>
            </div>
            <p className="text-gray-700 font-medium mb-1">No report generated yet</p>
            <p className="text-gray-400 text-sm mb-6">Generate a CEFR English proficiency report from the recording.</p>
            {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
            <button
              onClick={handleGenerateReport}
              disabled={generating}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition disabled:opacity-60"
            >
              {generating ? 'Generating report… this may take a minute' : 'Generate Report'}
            </button>
          </div>
        )}

        {!report && !isPast && (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center mb-6">
            <p className="text-gray-500 text-sm">This interview hasn't happened yet. The report will be available after the meeting.</p>
          </div>
        )}

        {/* Report */}
        {report && (
          <>
            {/* Summary card */}
            <div className={`rounded-xl p-6 mb-6 ${
              report.recommendation === 'move_forward'
                ? 'bg-green-50 border border-green-200'
                : 'bg-red-50 border border-red-200'
            }`}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-2 h-2 rounded-full ${report.recommendation === 'move_forward' ? 'bg-green-500' : 'bg-red-500'}`} />
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recommendation</p>
              </div>
              <p className="text-gray-800 text-sm leading-relaxed mb-2">{report.recommendation_reason}</p>
              <p className="text-gray-600 text-sm leading-relaxed">{report.summary}</p>
            </div>

            {/* Score breakdown */}
            <div className="bg-white rounded-xl border border-gray-200 mb-6 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-700">Language Skills Breakdown</h2>
              </div>
              <div className="divide-y divide-gray-50">
                {[
                  { label: 'Fluency', value: report.fluency },
                  { label: 'Vocabulary', value: report.vocabulary },
                  { label: 'Grammar', value: report.grammar },
                  { label: 'Clarity & Pronunciation', value: report.clarity },
                ].map(item => (
                  <div key={item.label} className="px-6 py-4 flex gap-4">
                    <div className="w-28 shrink-0">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{item.label}</p>
                    </div>
                    <p className="text-sm text-gray-700">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Strengths + Areas */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Strengths</p>
                <ul className="space-y-2">
                  {report.strengths.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <span className="text-green-500 mt-0.5 shrink-0">✓</span>{s}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Areas for Improvement</p>
                <ul className="space-y-2">
                  {report.areas_for_improvement.map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <span className="text-orange-400 mt-0.5 shrink-0">→</span>{a}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Transcript */}
            {interview.transcript && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100">
                  <h2 className="text-sm font-semibold text-gray-700">Interview Transcript</h2>
                </div>
                <div className="px-6 py-5">
                  <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{interview.transcript}</p>
                </div>
              </div>
            )}
          </>
        )}

        <p className="text-xs text-gray-400 text-center mt-8">Generated by Zonora · Powered by Nearwork</p>
      </div>
    </main>
  )
}
