package security

import (
	"bytes"
	"sync"
)

// LineMasker joins split writes before masking. Oversized lines are dropped fail-closed.
type LineMasker struct {
	mu       sync.Mutex
	buf      []byte
	dropping bool
	mask     *Redactor
	emit     func([]byte)
}

func NewLineMasker(r *Redactor, emit func([]byte)) *LineMasker {
	return &LineMasker{mask: r, emit: emit}
}
func (m *LineMasker) Write(b []byte) (int, error) {
	n := len(b)
	m.mu.Lock()
	defer m.mu.Unlock()
	for len(b) > 0 {
		i := bytes.IndexByte(b, '\n')
		if i < 0 {
			i = len(b) - 1
		} else {
		}
		part := b[:i+1]
		newline := part[len(part)-1] == '\n'
		if !m.dropping {
			if len(m.buf)+len(part) > 1<<20 {
				m.buf = nil
				m.dropping = true
			} else {
				m.buf = append(m.buf, part...)
			}
		}
		if newline {
			if m.dropping {
				m.emit([]byte("[oversized log line omitted]\n"))
			} else {
				m.flush()
			}
			m.dropping = false
		}
		b = b[i+1:]
	}
	return n, nil
}
func (m *LineMasker) flush() {
	safe := []byte(m.mask.Mask(string(m.buf)))
	for len(safe) > 0 {
		n := min(len(safe), 16384)
		m.emit(safe[:n])
		safe = safe[n:]
	}
	m.buf = m.buf[:0]
}
func (m *LineMasker) Flush() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.dropping {
		m.flush()
	}
	m.buf = nil
}
