// SiYuan - Build Your Eternal Digital Garden
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/dustin/go-humanize"
	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	syncSameCount        = 0
	syncDownloadErrCount = 0
	fixSyncInterval      = 5 * time.Minute
	syncPlanTime         = time.Now().Add(fixSyncInterval)

	BootSyncSucc = -1 // -1：未执行，0：执行成功，1：执行失败
	ExitSyncSucc = -1
)

func AutoSync() {
	for {
		time.Sleep(5 * time.Second)
		if time.Now().After(syncPlanTime) {
			SyncData(false, false, false)
		}
	}
}

func BootSyncData() {
	defer logging.Recover()

	if util.IsMutexLocked(&syncLock) {
		logging.LogWarnf("sync is in progress")
		planSyncAfter(30 * time.Second)
		return
	}

	syncLock.Lock()
	defer syncLock.Unlock()

	util.IncBootProgress(3, "Syncing data from the cloud...")
	BootSyncSucc = 0

	if !Conf.Sync.Enabled || !cloud.IsValidCloudDirName(Conf.Sync.CloudName) {
		return
	}

	if !IsSubscriber() && conf.ProviderSiYuan == Conf.Sync.Provider {
		return
	}

	logging.LogInfof("sync before boot")

	if 7 < syncDownloadErrCount {
		logging.LogErrorf("sync download error too many times, cancel auto sync, try to sync by hand")
		util.PushErrMsg(Conf.Language(125), 1000*60*60)
		planSyncAfter(64 * time.Minute)
		return
	}

	now := util.CurrentTimeMillis()
	Conf.Sync.Synced = now

	util.BroadcastByType("main", "syncing", 0, Conf.Language(81), nil)
	err := bootSyncRepo()
	synced := util.Millisecond2Time(Conf.Sync.Synced).Format("2006-01-02 15:04:05") + "\n\n"
	if nil == err {
		synced += Conf.Sync.Stat
	} else {
		synced += fmt.Sprintf(Conf.Language(80), formatErrorMsg(err))
	}
	msg := fmt.Sprintf(Conf.Language(82), synced)
	Conf.Sync.Stat = msg
	Conf.Save()
	util.BroadcastByType("main", "syncing", 1, msg, nil)
	return
}

func SyncData(boot, exit, byHand bool) {
	defer logging.Recover()

	if !boot && !exit && 2 == Conf.Sync.Mode && !byHand {
		return
	}

	if util.IsMutexLocked(&syncLock) {
		logging.LogWarnf("sync is in progress")
		planSyncAfter(30 * time.Second)
		return
	}

	syncLock.Lock()
	defer syncLock.Unlock()

	if boot {
		util.IncBootProgress(3, "Syncing data from the cloud...")
		BootSyncSucc = 0
	}
	if exit {
		ExitSyncSucc = 0
	}

	if !Conf.Sync.Enabled {
		if byHand {
			util.PushMsg(Conf.Language(124), 5000)
		}
		return
	}

	if !cloud.IsValidCloudDirName(Conf.Sync.CloudName) {
		if byHand {
			util.PushMsg(Conf.Language(123), 5000)
		}
		return
	}

	if !IsSubscriber() && conf.ProviderSiYuan == Conf.Sync.Provider {
		return
	}

	if !cloud.IsValidCloudDirName(Conf.Sync.CloudName) {
		return
	}

	if boot {
		logging.LogInfof("sync before boot")
	}
	if exit {
		logging.LogInfof("sync before exit")
		util.PushMsg(Conf.Language(81), 1000*60*15)
	}

	if 7 < syncDownloadErrCount && !byHand {
		logging.LogErrorf("sync download error too many times, cancel auto sync, try to sync by hand")
		util.PushErrMsg(Conf.Language(125), 1000*60*60)
		planSyncAfter(64 * time.Minute)
		return
	}

	now := util.CurrentTimeMillis()
	Conf.Sync.Synced = now

	util.BroadcastByType("main", "syncing", 0, Conf.Language(81), nil)
	err := syncRepo(exit, byHand)
	synced := util.Millisecond2Time(Conf.Sync.Synced).Format("2006-01-02 15:04:05") + "\n\n"
	if nil == err {
		synced += Conf.Sync.Stat
	} else {
		synced += fmt.Sprintf(Conf.Language(80), formatErrorMsg(err))
	}
	msg := fmt.Sprintf(Conf.Language(82), synced)
	Conf.Sync.Stat = msg
	Conf.Save()
	util.BroadcastByType("main", "syncing", 1, msg, nil)
	return
}

// incReindex 增量重建索引。
func incReindex(upserts, removes []string) {
	util.IncBootProgress(3, "Sync reindexing...")
	needPushRemoveProgress := 32 < len(removes)
	needPushUpsertProgress := 32 < len(upserts)
	msg := fmt.Sprintf(Conf.Language(35))
	util.PushStatusBar(msg)
	if needPushRemoveProgress || needPushUpsertProgress {
		util.PushEndlessProgress(msg)
	}

	// 先执行 remove，否则移动文档时 upsert 会被忽略，导致未被索引
	bootProgressPart := 10 / float64(len(removes))
	for _, removeFile := range removes {
		if !strings.HasSuffix(removeFile, ".sy") {
			continue
		}

		id := strings.TrimSuffix(filepath.Base(removeFile), ".sy")
		block := treenode.GetBlockTree(id)
		if nil != block {
			msg = fmt.Sprintf(Conf.Language(39), block.RootID)
			util.IncBootProgress(bootProgressPart, msg)
			util.PushStatusBar(msg)
			if needPushRemoveProgress {
				util.PushEndlessProgress(msg)
			}

			treenode.RemoveBlockTreesByRootID(block.RootID)
			sql.RemoveTreeQueue(block.BoxID, block.RootID)
		}
	}

	msg = fmt.Sprintf(Conf.Language(35))
	util.PushStatusBar(msg)
	if needPushRemoveProgress || needPushUpsertProgress {
		util.PushEndlessProgress(msg)
	}

	bootProgressPart = 10 / float64(len(upserts))
	for _, upsertFile := range upserts {
		if !strings.HasSuffix(upsertFile, ".sy") {
			continue
		}

		upsertFile = filepath.ToSlash(upsertFile)
		if strings.HasPrefix(upsertFile, "/") {
			upsertFile = upsertFile[1:]
		}
		idx := strings.Index(upsertFile, "/")
		if 0 > idx {
			// .sy 直接出现在 data 文件夹下，没有出现在笔记本文件夹下的情况
			continue
		}

		box := upsertFile[:idx]
		p := strings.TrimPrefix(upsertFile, box)
		msg = fmt.Sprintf(Conf.Language(40), strings.TrimSuffix(path.Base(p), ".sy"))
		util.IncBootProgress(bootProgressPart, msg)
		util.PushStatusBar(msg)
		if needPushUpsertProgress {
			util.PushEndlessProgress(msg)
		}

		tree, err0 := LoadTree(box, p)
		if nil != err0 {
			continue
		}
		treenode.ReindexBlockTree(tree)
		sql.UpsertTreeQueue(tree)
	}

	util.PushStatusBar(Conf.Language(58))
	if needPushRemoveProgress || needPushUpsertProgress {
		util.PushEndlessProgress(Conf.Language(58))
	}
}

func SetCloudSyncDir(name string) {
	if Conf.Sync.CloudName == name {
		return
	}

	syncLock.Lock()
	defer syncLock.Unlock()

	Conf.Sync.CloudName = name
	Conf.Save()
}

func SetSyncGenerateConflictDoc(b bool) {
	syncLock.Lock()
	defer syncLock.Unlock()

	Conf.Sync.GenerateConflictDoc = b
	Conf.Save()
	return
}

func SetSyncEnable(b bool) (err error) {
	syncLock.Lock()
	defer syncLock.Unlock()

	Conf.Sync.Enabled = b
	Conf.Save()
	return
}

func SetSyncMode(mode int) (err error) {
	syncLock.Lock()
	defer syncLock.Unlock()

	Conf.Sync.Mode = mode
	Conf.Save()
	return
}

var syncLock = sync.Mutex{}

func CreateCloudSyncDir(name string) (err error) {
	syncLock.Lock()
	defer syncLock.Unlock()

	name = strings.TrimSpace(name)
	name = gulu.Str.RemoveInvisible(name)
	if !cloud.IsValidCloudDirName(name) {
		return errors.New(Conf.Language(37))
	}

	repo, err := newRepository()
	if nil != err {
		return
	}

	err = repo.CreateCloudRepo(name)
	return
}

func RemoveCloudSyncDir(name string) (err error) {
	msgId := util.PushMsg(Conf.Language(116), 15000)

	syncLock.Lock()
	defer syncLock.Unlock()

	if "" == name {
		return
	}

	repo, err := newRepository()
	if nil != err {
		return
	}

	err = repo.RemoveCloudRepo(name)
	if nil != err {
		err = errors.New(formatErrorMsg(err))
		return
	}

	util.PushClearMsg(msgId)
	time.Sleep(500 * time.Millisecond)
	if Conf.Sync.CloudName == name {
		Conf.Sync.CloudName = "main"
		Conf.Save()
		util.PushMsg(Conf.Language(155), 5000)
	}
	return
}

func ListCloudSyncDir() (syncDirs []*Sync, hSize string, err error) {
	syncDirs = []*Sync{}
	var dirs []*cloud.Repo
	var size int64

	repo, err := newRepository()
	if nil != err {
		return
	}

	dirs, size, err = repo.GetCloudRepos()
	if nil != err {
		err = errors.New(formatErrorMsg(err))
		return
	}
	if 1 > len(dirs) {
		dirs = append(dirs, &cloud.Repo{
			Name:    "main",
			Size:    0,
			Updated: time.Now().Format("2006-01-02 15:04:05"),
		})
	}

	for _, d := range dirs {
		dirSize := d.Size
		syncDirs = append(syncDirs, &Sync{
			Size:      dirSize,
			HSize:     humanize.Bytes(uint64(dirSize)),
			Updated:   d.Updated,
			CloudName: d.Name,
		})
	}
	hSize = humanize.Bytes(uint64(size))
	return
}

func formatErrorMsg(err error) string {
	if errors.Is(err, cloud.ErrCloudAuthFailed) {
		return Conf.Language(31) + " v" + util.Ver
	}

	msg := err.Error()
	msgLowerCase := strings.ToLower(msg)
	if strings.Contains(msgLowerCase, "permission denied") || strings.Contains(msg, "access is denied") {
		msg = Conf.Language(33) + " " + err.Error()
	} else if strings.Contains(msgLowerCase, "device or resource busy") || strings.Contains(msg, "is being used by another") {
		msg = fmt.Sprintf(Conf.Language(85), err)
	} else if strings.Contains(msgLowerCase, "cipher: message authentication failed") {
		msg = Conf.Language(135)
	} else if strings.Contains(msgLowerCase, "repo fatal error") {
		msg = Conf.Language(23)
	} else if strings.Contains(msgLowerCase, "no such host") || strings.Contains(msgLowerCase, "connection failed") || strings.Contains(msgLowerCase, "hostname resolution") || strings.Contains(msgLowerCase, "No address associated with hostname") {
		msg = Conf.Language(24)
	} else if strings.Contains(msgLowerCase, "net/http: request canceled while waiting for connection") || strings.Contains(msgLowerCase, "exceeded while awaiting") || strings.Contains(msgLowerCase, "context deadline exceeded") || strings.Contains(msgLowerCase, "timeout") || strings.Contains(msgLowerCase, "context cancellation while reading body") {
		msg = Conf.Language(24)
	} else if strings.Contains(msgLowerCase, "connection was") || strings.Contains(msgLowerCase, "reset by peer") || strings.Contains(msgLowerCase, "refused") || strings.Contains(msgLowerCase, "socket") {
		msg = Conf.Language(28)
	} else if strings.Contains(msgLowerCase, "cloud object not found") {
		msg = Conf.Language(129)
	}
	msg = msg + " v" + util.Ver
	return msg
}

func getIgnoreLines() (ret []string) {
	ignore := filepath.Join(util.DataDir, ".siyuan", "syncignore")
	err := os.MkdirAll(filepath.Dir(ignore), 0755)
	if nil != err {
		return
	}
	if !gulu.File.IsExist(ignore) {
		if err = gulu.File.WriteFileSafer(ignore, nil, 0644); nil != err {
			logging.LogErrorf("create syncignore [%s] failed: %s", ignore, err)
			return
		}
	}
	data, err := os.ReadFile(ignore)
	if nil != err {
		logging.LogErrorf("read syncignore [%s] failed: %s", ignore, err)
		return
	}
	dataStr := string(data)
	dataStr = strings.ReplaceAll(dataStr, "\r\n", "\n")
	ret = strings.Split(dataStr, "\n")

	// 默认忽略帮助文档
	ret = append(ret, "20210808180117-6v0mkxr/**/*")
	ret = append(ret, "20210808180117-czj9bvb/**/*")
	ret = append(ret, "20211226090932-5lcq56f/**/*")

	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func IncSync() {
	syncSameCount = 0
	planSyncAfter(30 * time.Second)
}

func planSyncAfter(d time.Duration) {
	syncPlanTime = time.Now().Add(d)
}
