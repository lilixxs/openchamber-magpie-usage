package agent

// Dynamic constructors use identifiers, not icon names:
// return &Agent{ID: id, Name: name, Icon: icon}
const CursorLocalID = "cursor-local"
const ScienceID = gateway.ScienceID

var others = []*Agent{
	{ID: "magpie", Name: "magpie", Icon: "magpie", UA: []string{"magpie"}},
	{ID: "raft", Name: "Raft", Icon: "generic"},
}

func detected() *Agent {
	return &Agent{
		ID: "codex", Name: "Codex", Icon: "codex-color",
		Fields: []Field{
			{Key: "model", Label: "Model", Options: func(map[string]string) []Option {
				return []Option{{Value: "auto", Note: "let Codex pick", Icon: "codex-color"}}
			}},
		},
	}
}

func generated() *Agent {
	return &Agent{ID: CursorLocalID, Name: "Cursor Local", Icon: "cursor"}
}

// An unresolved identifier must not become an icon mapping.
func unresolved() *Agent {
	return &Agent{ID: ScienceID, Name: "Science", Icon: "claude-color"}
}
