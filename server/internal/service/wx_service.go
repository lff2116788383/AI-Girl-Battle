package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"ai-girl-battle-server/internal/config"
)

// WxService 微信登录（code2session）
// WX_APPID/WX_SECRET 未配置时走开发模拟模式：openid = "dev_" + code
type WxService struct {
	cfg *config.Config
}

func NewWxService(cfg *config.Config) *WxService {
	return &WxService{cfg: cfg}
}

type wxSession struct {
	OpenID  string `json:"openid"`
	UserKey string `json:"session_key"`
	ErrCode int    `json:"errcode"`
	ErrMsg  string `json:"errmsg"`
}

// Code2Session 微信 code 换 openid
func (s *WxService) Code2Session(code string) (string, error) {
	// 开发模拟模式
	if s.cfg.Wx.AppID == "" || s.cfg.Wx.Secret == "" {
		return "dev_" + code, nil
	}

	url := fmt.Sprintf(
		"https://api.weixin.qq.com/sns/jscode2session?appid=%s&secret=%s&js_code=%s&grant_type=authorization_code",
		s.cfg.Wx.AppID, s.cfg.Wx.Secret, code)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return "", fmt.Errorf("请求微信接口失败: %w", err)
	}
	defer resp.Body.Close()

	var session wxSession
	if err := json.NewDecoder(resp.Body).Decode(&session); err != nil {
		return "", fmt.Errorf("解析微信响应失败: %w", err)
	}
	if session.ErrCode != 0 {
		return "", fmt.Errorf("微信登录失败: %d %s", session.ErrCode, session.ErrMsg)
	}
	if session.OpenID == "" {
		return "", errors.New("微信未返回 openid")
	}
	return session.OpenID, nil
}
