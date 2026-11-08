package provider

var geminiApp = googleApp{
	agent: "gemini", name: "Gemini CLI", icon: "geminicli-color", website: "https://github.com/google-gemini/gemini-cli",
}

var antigravityApp = googleApp{
	agent: "antigravity", name: "Antigravity", icon: "antigravity-color",
}

// The usage card face supplements the preset/agent tables.
func accountCard(agent string) cardFace {
	switch agent {
	case "claude":
		return cardFace{"Claude Code", "claude-color"}
	case "codex":
		return cardFace{"Codex", "codex-color"}
	case "copilot":
		return cardFace{"Copilot", "githubcopilot"}
	case "gemini", "antigravity":
		app, _ := googleAppOf(agent)
		return cardFace{app.name, app.icon}
	}
	return cardFace{}
}
