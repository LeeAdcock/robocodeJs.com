import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'

import Logs from './logs'

let eventSource: EventSource | undefined

interface LogEntry {
    id: string
    name: string
    level: number
    levelName: string
    msg: string
    time: number
}

interface LogEntries {
    logs: (LogEntry | null)[]
    index: number
}

export default function ArenaLogsPage() {
    const [logEntries, setLogEntries] = useState({
        logs: new Array(500) as LogEntry[],
        index: 0,
    } as LogEntries)
    const { userId } = useParams()

    useEffect(() => {
        if (eventSource) {
            eventSource.close()
            eventSource = undefined
        }
        eventSource = new EventSource(
            `${window.location.protocol}//${window.location.host}/api/user/${userId}/arena/logs`
        )

        eventSource.onmessage = (message) => {
            setLogEntries((oldLogs) => {
                const logEntry = JSON.parse(message.data) as LogEntry
                oldLogs.logs[oldLogs.index] = logEntry
                return {
                    logs: oldLogs.logs,
                    index: (oldLogs.index + 1) % oldLogs.logs.length,
                }
            })
        }

        return () => {
            eventSource?.close()
        }
    }, [])

    return (
        <>
            <Logs logEntries={logEntries} selectedTankApp={''} />
        </>
    )
}
