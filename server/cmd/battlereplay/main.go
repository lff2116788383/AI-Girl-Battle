// battlereplay: 对拍工具 —— 读取 fixtures JSON，跑全部对战，输出帧列表。
// 用法: battlereplay <fixtures.json> <battle-rules.json>
// 输出: {"results":[{"name","winner","turns","frames":[...]}]}
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"ai-girl-battle-server/internal/battle"
)

type Case struct {
	Name     string                   `json:"name"`
	Seed     uint32                   `json:"seed"`
	SideA    []battle.PetInput        `json:"sideA"`
	SideB    []battle.PetInput        `json:"sideB"`
	Commands [][]*battle.BattleCommand `json:"commands"`
}

type Fixtures struct {
	Cases []Case `json:"cases"`
}

type CaseResult struct {
	Name   string        `json:"name"`
	Winner int           `json:"winner"`
	Turns  int           `json:"turns"`
	Frames []battle.Frame `json:"frames"`
}

type ReplayOutput struct {
	Results []CaseResult `json:"results"`
}

func main() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "usage: battlereplay <fixtures.json> <battle-rules.json>")
		os.Exit(1)
	}
	fxData, err := os.ReadFile(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, "read fixtures:", err)
		os.Exit(1)
	}
	rulesData, err := os.ReadFile(os.Args[2])
	if err != nil {
		fmt.Fprintln(os.Stderr, "read rules:", err)
		os.Exit(1)
	}
	var rules battle.BattleRules
	if err := json.Unmarshal(rulesData, &rules); err != nil {
		fmt.Fprintln(os.Stderr, "parse rules:", err)
		os.Exit(1)
	}
	var fx Fixtures
	if err := json.Unmarshal(fxData, &fx); err != nil {
		fmt.Fprintln(os.Stderr, "parse fixtures:", err)
		os.Exit(1)
	}

	out := ReplayOutput{Results: []CaseResult{}}
	for _, c := range fx.Cases {
		res := battle.RunBattle(c.Seed, &rules, c.SideA, c.SideB, c.Commands)
		out.Results = append(out.Results, CaseResult{
			Name:   c.Name,
			Winner: res.Result.Winner,
			Turns:  res.Result.Turns,
			Frames: res.Frames,
		})
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(out); err != nil {
		fmt.Fprintln(os.Stderr, "encode:", err)
		os.Exit(1)
	}
}
