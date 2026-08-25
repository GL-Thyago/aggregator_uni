<?php
// Disable default waring of PHP
error_reporting(E_ERROR | E_PARSE);
// Allow CORs
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Origin, X-Ncash-token, Content-Type, Accept');
header('Access-Control-Allow-Methods: POST, GET, PUT, OPTIONS, DELETE');
header('Content-Type: application/json; charset=utf-8');

class MyDB extends SQLite3
{
    function __construct()
    {
        $this->open('../private/db/gameprovider.db');
    }
}

$apidata = new stdClass;
$errors = array();
$success = true;
$msg = "";
$data = [];
$json = file_get_contents('php://input');
$p = json_decode($json);
$act = isset($p->action) ? $p->action : null;
$gameName = isset($p->game) ? $p->game : null;
$player = isset($p->player) ? $p->player : null;
$credit = isset($p->credit) ? $p->credit : null;
$page = isset($p->page) ? $p->page : null;
$id = isset($p->id) ? $p->id : null;
$index = isset($p->index) ? $p->index : null;
$path = "../private/games";
$SIGNUP_BONUS = 80;
$SIGN_FEATURE_CREDIT = 500;
$SIGN_FEATURE_SPIN = 50;
$SYSTEM_RTP = 94;
$SHARE_FEATURE = 40;
$resData = [];
$USE_RTP = false;


if (!empty($act)) {
    $getHeader = getallheaders();
    $token =  isset($getHeader['X-Ncash-Token']) ? $getHeader['X-Ncash-Token'] : (isset($getHeader['X-Ncash-token']) ? $getHeader['X-Ncash-token'] : (isset($getHeader['x-ncash-token']) ? $getHeader['x-ncash-token'] : 'wrong-key'));
    $game_file = file_get_contents("$path/$gameName/ncashgame.json");
    $gameData = (object) json_decode($game_file, true);
    $game_rule = file_get_contents("$path/$gameName/game_rule.json");
    $gameRule = (object) json_decode($game_rule, true);
    $db = new MyDB();
    if ($db) {
        createSessionEntity($db);
        createSpinlogs($db);
        createPlayerEntity($db);

        if ($act === 'launch') {
            $pay = $gameRule->feature_in[0]['pay'];
            $featureIn = explode(',', $pay);
            $featureOut =  $gameRule->feature_out;
            $select = $featureOut[3]['data'];
            $dataType = "normal";
            spinConfig($path, $gameName, $dataType);
            for ($i = 0; $i < count($featureOut); $i++) {
                if ($featureIn[1] == $featureOut[$i]['name']) {
                    for ($j = 1; $j < 6; $j++) {
                        if (isset($select["select" . $j . "_free_spin"])) {
                            $multi[]  = [
                                "index" => $j,
                                "free_num" => $select["select" . $j . "_free_spin"],
                                "multiply_1" => $select["select" . $j . "_multiply_1"],
                                "multiply_2" => $select["select" . $j . "_multiply_2"],
                                "multiply_3" => $select["select" . $j . "_multiply_3"],
                                "multiply_4" => $select["select" . $j . "_multiply_4"],
                            ];
                        } else {
                            break;
                        }
                    }
                }
            }
            $multiSelect = isset($multi) ?  $multi : [];
            if (count($multiSelect) > 0) {
                for ($i = 1; $i < count($multi) + 1; $i++) {
                    $dataType = "feature_$i";
                    spinConfig($path, $gameName, $dataType);
                }
            } else {
                $dataType = "feature";
                spinConfig($path, $gameName, $dataType);
            }
            $userName = !empty($player) ? $player : 'guest_01';
            $wallet = !empty($credit) ? $credit : 0;
            $playerId = PlayerEntityId($db, $userName);
            if (!$playerId) {
                insertPlayerEntity($userName, $wallet, $db);
            }
            $playerId = PlayerEntityId($db, $userName);
            $sessionId = SessionPlayerId($db, $playerId, $gameName);
            if (!$sessionId) {
                $token = generateRandomString(50);
                if ($gameName) {
                    $SIGNUP_BONUS = 80;
                    $baseBet    =  (float)$gameData->credit_line;
                    $betSize    =  (float)$gameData->bet_size;
                    $betLevel   =  (int)$gameData->bet_level;
                    $lineNum    =  (int)$gameData->line_num;
                    $curPrefix  =   $gameData->currency_prefix;
                    $curSuffix    =   $gameData->currency_suffix;
                    $curThousand   =   $gameData->currency_thousand;
                    $curDecimal    =   $gameData->currency_decimal;
                    $defBetSize    =   $gameData->default_bet_size ? $gameData->default_bet_size : [0.01, 0.03, 0.05];
                    $ssData = (object) [
                        'numline' => $baseBet,
                        'betamount' => $betSize,
                        'freespin' => 0,
                        'cpl' => $betLevel,
                        'linenum' => $lineNum,
                        'currency_prefix' => $curPrefix,
                        'currency_suffix' => $curSuffix,
                        'currency_thousand' => $curThousand,
                        'currency_decimal' => $curDecimal,
                        'default_bet_size' => $defBetSize,
                        'parent_id' => 0,
                        'multiply_select' => $multiSelect,
                        'free_spin_index' => 0,
                        // ** New multiply control
                        'multiply_continuous' => false,
                        'last_multiply' => 0,
                        "fileName" => "",
                        "lineIndex" => 1
                    ];
                    $sessionData = json_encode($ssData);
                    insertSessionEntity($playerId, $gameName, $token, $sessionData, $SIGNUP_BONUS, $db);
                    $sessionId = SessionId($db, $token);
                    if (!$sessionId) {
                        $errors[] = "token cant create";
                    }
                } else {
                    $errors[] = "Game is not found";
                }
            }
            $ssData = (object)[
                "session_id" => $sessionId
            ];
            if ($sessionId) {
                $resData =  [
                    "session_id" => $sessionId
                ];
            } else {
                $errors[] = "session load fail";
            }
        }
        if ($act === 'session') {
            $ssData = null;
            // $getHeader = getallheaders();
            // $token =  $getHeader['X-Ncash-token'];
            $session = SessionToken($db, $token, $gameName);
            if ($session) {
                $sessionsEntity = SessionEntity($db, $token);
                $ssData = json_decode($sessionsEntity['session_data']);
                $playerId = $sessionsEntity['player_id'];
                $playerEntity = PlayerEntity($db, $playerId);
                $userName = $playerEntity['user_name'];
                $credit = $playerEntity['credit'];
                $freeTotal = isset($ssData->freeTotal) == "undefined" ? $ssData->freeTotal : 0;
                $freeAmount = isset($ssData->freespin_amount) == "undefined" ? $ssData->freespin_amount : 0;
                $freeMultil = isset($ssData->freespin_multi) == "undefined" ? $ssData->freespin_multi : 0;
                $freeMode = isset($ssData->free_spin_index) == "undefined" ? $ssData->free_spin_index : 0;
                $multiList = isset($ssData->multiple_list) == "undefined" ? $ssData->multiple_list : 0;
                $buyFeature = isset($gameData->buy_feature) ? $gameData->buy_feature : 0;
                $buyMax = isset($gameData->buy_max) ? $gameData->buy_max : 0;
                $iconData = isset($ssData->icon_data) == "undefined" ? $ssData->icon_data : 0;
                $activeLine = isset($ssData->active_lines) == "undefined" ? $ssData->active_lines : 0;
                $dropLine = isset($ssData->drop_line) == "undefined" ? $ssData->drop_line : 0;
                $betSizeList = isset($ssData->default_bet_size) == "undefined" ? $ssData->default_bet_size : 0;
                $resData = (object)[
                    'user_name' => $userName,
                    'credit' => (float) number_format($credit, 2, '.', ''),
                    'num_line' => $ssData->numline,
                    'line_num' => $ssData->linenum,
                    'bet_amount' => $ssData->betamount,
                    'free_num' => $ssData->freespin,
                    'free_total' => $freeTotal,
                    'free_amount' => $freeAmount,
                    'free_multi' => $freeMultil,
                    'freespin_mode' => $freeMode,
                    'multiple_list' => $multiList,
                    'credit_line' => $ssData->cpl,
                    'buy_feature' => $buyFeature,
                    'buy_max' => $buyMax,
                    "feature" => (object)[],
                    "total_way" => 0,
                    "multipy" => 0,
                    'icon_data' => $iconData,
                    'active_lines' => $activeLine,
                    'drop_line' => $dropLine,
                    'currency_prefix' => $ssData->currency_prefix,
                    'currency_suffix' => $ssData->currency_suffix,
                    'currency_thousand' => $ssData->currency_thousand,
                    'currency_decimal' => $ssData->currency_decimal,
                    'bet_size_list' => $betSizeList,
                    "previous_session" => false,
                    "game_state" => null
                ];
            } else {
                $errors[] = "Token not found";
            }
        }
        if ($act === 'icons') {
            $ssData = null;
            // $getHeader = getallheaders();
            // $token =  isset($getHeader['X-Ncash-Token']) ? $getHeader['X-Ncash-Token'] : ( isset($getHeader['X-Ncash-token']) ? $getHeader['X-Ncash-token'] : (isset($getHeader['x-ncash-token']) ? $getHeader['x-ncash-token'] : 'wrong-key'));
            $session = SessionToken($db, $token, $gameName);
            if ($session) {
                if ($gameRule && $gameData) {
                    $iconList = [];
                    $payout = $gameRule->payout;
                    for ($i = 0; $i < count($payout); $i++) {
                        $iconItem = null;
                        $fId = -1;
                        for ($n = 0; $n < count($iconList); $n++) {
                            if ($iconList[$n]['name'] == $payout[$i]['name']) {
                                $iconItem = $iconList[$n];
                                $fId = $n;
                                break;
                            }
                        }
                        if ($iconItem !== null) {
                            if ($fId > -1) {
                                $iconList[$fId]['win_' . $payout[$i]['require']] = $payout[$i]['pay'];
                            }
                        } else {
                            $iconItem = ['name' => $payout[$i]['name']];
                            $iconItem['win_' . $payout[$i]['require']] = $payout[$i]['pay'];
                            $iconList[] = $iconItem;
                        }
                    }

                    $res = [];
                    $icons = $gameData->icons;
                    for ($i = 0; $i < count($icons); $i++) {
                        $iconItem = null;
                        for ($n = 0; $n < count($iconList); $n++) {
                            if ($iconList[$n]['name'] == $icons[$i]['name']) {
                                $iconItem = $iconList[$n];
                                break;
                            }
                            $resData[] = [
                                "icon_name" => $icons[$i]['name'],
                                "win_1" => isset($iconItem['win_1']) ? $iconItem['win_1'] : 0,
                                "win_2" => isset($iconItem['win_2']) ? $iconItem['win_2'] : 0,
                                "win_3" => isset($iconItem['win_3']) ? $iconItem['win_3'] : 0,
                                "win_4" => isset($iconItem['win_4']) ? $iconItem['win_4'] : 0,
                                "win_5" => isset($iconItem['win_5']) ? $iconItem['win_5'] : 0,
                                "win_6" => isset($iconItem['win_6']) ? $iconItem['win_6'] : 0,
                                "wild_card" => 0,
                                "free_spin" => 0,
                                "free_num" => 0,
                                "scaler_spin" => 0,
                            ];
                        }
                    }
                } else {
                    $success = false;
                    $errors[] = "Game or Rule is not found";
                }
            } else {
                $success = false;
                $errors[] = "Session is not found!";
            }
        }

        if ($act === "spin") {
            $success = false;
            $betamount = isset($p->betamount) ? $p->betamount : null;
            $cpl = isset($p->cpl) ? $p->cpl : null;
            // $getHeader = getallheaders();
            // $token =  $getHeader['X-Ncash-token'];
            $session = SessionToken($db, $token, $gameName);
            if ($session) {
                $sessionsEntity = SessionEntity($db, $token);
                $ssData = json_decode($sessionsEntity['session_data']);
                $playerId = $sessionsEntity['player_id'];
                $nextRunFeature = $sessionsEntity['nextRun_feature'];
                $sRtpNormal = $sessionsEntity['return_normal'];
                $sRtpFeature = $sessionsEntity['return_feature'];
                $sessionId = $sessionsEntity['session_id'];
                $playerEntity = PlayerEntity($db, $playerId);
                $userName = $playerEntity['user_name'];
                $credit = $playerEntity['credit'];
                $nextRunFeature = isset($nextRunFeature) ? $nextRunFeature : 0;
                $numFreeSpin = isset($ssData->freespin) ? $ssData->freespin : 0;
                $isContinuous = isset($ssData->multiply_continuous) ? $ssData->multiply_continuous : 0;
                $prevMultiply = isset($ssData->last_multiply) ? $ssData->last_multiply : 0;
                $freeMode = $numFreeSpin > 0 || $numFreeSpin == -1;
                $dataType = $freeMode ? 'feature' : 'normal';
                $freeSpinindex = $freeMode ? $ssData->free_spin_index : 0;
                if ($freeSpinindex > 0) {
                    $dataType = "feature_$freeSpinindex";
                }
                $spinData = spinConfig($path, $gameName, $dataType);
                if ($gameData && $gameRule && $spinData) {
                    $baseBet = (float)($gameData->credit_line);
                    if ($betamount && $cpl) {
                        $betSize = (float)$betamount;
                        $betLevel = (float)$cpl;
                        $ssData->betamount = $betSize;
                        $ssData->cpl = $betLevel;
                        $totalBet = $freeMode ? 0 : $baseBet * $betSize * $betLevel;
                        $ajustRatio = $betSize * $betLevel;
                        $wallet = $credit;

                        if ($wallet > $totalBet) {
                            $wallet = $wallet - $totalBet;
                            $sql = <<<EOF
                                UPDATE PlayerEntity set credit = $wallet where id = $playerId;
                                EOF;
                            $db->exec($sql);
                            // UpdatePlayerEntity($wallet, $playerId, $db);

                            $returnBet = $totalBet * $SYSTEM_RTP / 100;
                            $returnFeature = $returnBet * $SHARE_FEATURE / 100;
                            $returnNormal = $returnBet - $returnFeature;
                            $rtpNormal = $sRtpNormal + $returnNormal;
                            $rtpFeature = $sRtpFeature + $returnFeature;
                            $forceScatter = false;

                            if (!$freeMode && $rtpFeature >= $SIGN_FEATURE_CREDIT && $nextRunFeature >= $SIGN_FEATURE_SPIN) {
                                $featureRatio = 30;
                                $inArr = [];
                                for ($i = 0; $i < 100; $i++) {
                                    $hasIn = $i < $featureRatio;
                                    $inArr[] = $hasIn;
                                }
                                $forceScatter = $inArr[array_rand($inArr)];
                            }
                            $fileName = '';
                            $lineIndex = 0;

                            // $forceScatter = true; //Debug only
                            if ($forceScatter) {
                                $dataType = $$USE_RTP ? $dataType : "feature";
                                // $dataType = "feature";
                                $spinData = spinConfig($path, $gameName, $dataType);
                                $spinItem = (object)$spinData[array_rand($spinData)];
                                $fileName = $spinItem->file;
                                $nextRunFeature = 0;
                                $lineIndex = 1;
                                $ssData->fileName = $fileName;
                                $ssData->lineIndex = $lineIndex;
                            } else {
                                if (!$freeMode) {
                                    // $maxWin = $freeMode ? $rtpFeature / $ajustRatio : $rtpNormal / $ajustRatio;
                                    // $spinData = spinConfig($path, $gameName, $dataType);
                                    $spinItem = (object)$spinData[array_rand($spinData)];
                                    $FreeRatio = 10;
                                    $inArr = [];
                                    for ($i = 0; $i < 100; $i++) {
                                        $hasIn = $i < $FreeRatio;
                                        $inArr[] = $hasIn;
                                    }
                                    $forceData = $inArr[array_rand($inArr)];
                                    if ($forceData) {
                                        $maxWin = $USE_RTP ? $rtpNormal / $ajustRatio : $spinItem->win;
                                        $maxWin = $maxWin > 0 ? $maxWin : 0;
                                        $winData = [];
                                        for ($i = 0; $i < count($spinData); $i++) {
                                            $spin = (object) $spinData[$i];
                                            if ($spinData[$i]['win'] <= $maxWin) {
                                                $count = (int) $spinData[$i];
                                                while ($count > 0) {
                                                    $winData[] = $spinData[$i]['win'];
                                                    $count--;
                                                }
                                            }
                                        }
                                        $forceWin = $winData[array_rand($winData)];
                                        for ($i = 0; $i < count($spinData); $i++) {
                                            $win =  $spinData[$i]['win'];
                                            if ($win == $forceWin) {
                                                $fileName = $spinData[$i]['file'];
                                                $count = (int)$spinData[$i]['count'];
                                                $lineIndex = rand(1, $count);
                                            }
                                        }
                                    } else {
                                        $forceWin = 0;
                                        for ($i = 0; $i < count($spinData); $i++) {
                                            $win =  $spinData[$i]['win'];
                                            if ($win == $forceWin) {
                                                $fileName = $spinData[$i]['file'];
                                                $count = (int)$spinData[$i]['count'];
                                                $lineIndex = rand(1, $count);
                                            }
                                        }
                                    }
                                } else {
                                    if ($USE_RTP) {
                                        $maxWin = $rtpFeature / $ajustRatio;
                                        $maxWin = $maxWin > 0 ? $maxWin : 0;
                                        $winData = [];
                                        for ($i = 0; $i < count($spinData); $i++) {
                                            $spin = (object) $spinData[$i];
                                            if ($spinData[$i]['win'] <= $maxWin) {
                                                $count = (int) $spinData[$i];
                                                while ($count > 0) {
                                                    $winData[] = $spinData[$i]['win'];
                                                    $count--;
                                                }
                                            }
                                        }
                                        $forceWin = $winData[array_rand($winData)];
                                        for ($i = 0; $i < count($spinData); $i++) {
                                            $win =  $spinData[$i]['win'];
                                            if ($win == $forceWin) {
                                                $fileName = $spinData[$i]['file'];
                                                $count = (int)$spinData[$i]['count'];
                                                $lineIndex = rand(1, $count);
                                            }
                                        }
                                    } else {
                                        $fileName = $ssData->fileName;
                                        // $dataType = 'feature';
                                        $lineIndex = $ssData->lineIndex + 1;
                                        $ssData->lineIndex = $lineIndex;
                                    }
                                }
                            }
                            $pull = spinConfigData($path, $gameName, $fileName, $lineIndex, $dataType);
                            if ($pull) {
                                if ($freeMode && $isContinuous) {
                                    $totalWin = 0;
                                    $ajustWin = 0;
                                    $pull->LastMultiply = $pull->LastMultiply + $prevMultiply;
                                    for ($i = 0; $i < count($pull->ActiveLines); $i++) {
                                        $pull->ActiveLines[$i]->multiply = $pull->ActiveLines[$i]->multiply + $prevMultiply;
                                        $ajustMultiRatio = ($pull->ActiveLines[$i]->multiply + $prevMultiply) / $pull->ActiveLines[$i]->multiply;
                                        $pull->ActiveLines[$i]->win_amount = (float) number_format($pull->ActiveLines[$i]->win_amount * $ajustMultiRatio, 2, '.', '');
                                        $ajustWin = (float) number_format($ajustWin + $pull->ActiveLines[$i]->win_amount, 2, '.', '');
                                    }
                                    $pull->WinOnDrop = $ajustWin;
                                    $totalWin = $totalWin + $ajustWin;

                                    for ($d = 0; $d < count($pull->DropLineData); $d++) {
                                        $ajustWin = 0;
                                        for ($i = 0; $i < count($pull->DropLineData[$d]->ActiveLines); $i++) {
                                            $pull->DropLineData[$d]->ActiveLines[$i]->multiply = $pull->DropLineData[$d]->ActiveLines[$i]->multiply + $prevMultiply;
                                            $ajustMultiRatio = ($pull->DropLineData[$d]->ActiveLines[$i]->multiply + $prevMultiply) / $pull->DropLineData[$d]->ActiveLines[$i]->multiply;
                                            $pull->DropLineData[$d]->ActiveLines[$i]->win_amount = (float) number_format($pull->DropLineData[$d]->ActiveLines[$i]->win_amount * $ajustMultiRatio, 2, '.', '');
                                            $ajustWin = $ajustWin + $pull->DropLineData[$d]->ActiveLines[$i]->win_amount;
                                        }
                                        $pull->DropLineData[$d]->DropLineData = $ajustWin;
                                        $totalWin = $totalWin + $ajustWin;
                                    }
                                    $pull->WinAmount = $totalWin;
                                }
                                // Ajust betsize & level ratio (basic data is 1:1)
                                $pull->WinAmount = (float) number_format($pull->WinAmount * $ajustRatio, 2, '.', '');
                                $pull->WinOnDrop = (float) number_format($pull->WinOnDrop * $ajustRatio, 2, '.', '');
                                for ($i = 0; $i < count($pull->ActiveLines); $i++) {
                                    $pull->ActiveLines[$i]->win_amount = (float) number_format($pull->ActiveLines[$i]->win_amount * $ajustRatio, 2, '.', '');
                                }
                                for ($i = 0; $i < count($pull->DropLineData); $i++) {
                                    $pull->DropLineData[$i]->WinOnDrop = (float) number_format($pull->DropLineData[$i]->WinOnDrop * $ajustRatio, 2, '.', '');
                                    for ($j = 0; $j < count($pull->DropLineData[$i]->ActiveLines); $j++) {
                                        $pull->DropLineData[$i]->ActiveLines[$j]->win_amount = (float) number_format($pull->DropLineData[$i]->ActiveLines[$j]->win_amount * $ajustRatio, 2, '.', '');
                                    }
                                }
                                $winAmount = $pull->WinAmount;
                                if ($winAmount > 0) {
                                    $wallet = $wallet + $winAmount;
                                    $sql = <<<EOF
                                        UPDATE PlayerEntity set credit = $wallet where id = $playerId;
                                        EOF;
                                    $db->exec($sql);
                                    // UpdatePlayerEntity($wallet, $playerId, $db);
                                    if ($freeMode) {
                                        $rtpFeature = $rtpFeature - $winAmount;
                                    } else {
                                        $rtpNormal = $rtpNormal - $winAmount;
                                    }
                                }
                                if ($freeMode && $isContinuous) {
                                    $ssData->last_multiply = $pull->LastMultiply;
                                }
                                if (!$freeMode) {
                                    $nextRunFeature = $nextRunFeature + 1;
                                }
                                // $newFreeSpin = $freeMode ? $numFreeSpin - 1 : $pull->FreeSpin;
                                $newFreeSpin = $pull->FreeSpin;
                                $ssData->freespin = $newFreeSpin;
                                $freeSpin = $newFreeSpin > 0 || $newFreeSpin == -1 ? 1 : 0;
                                if ($freeMode && $newFreeSpin == 0) {
                                    $ssData->last_multiply = 0;
                                }

                                $WinLogs = implode("\n", $pull->WinLogs);
                                $ActiveIcons = json_encode($pull->ActiveIcons);
                                $ActiveLines = json_encode($pull->ActiveLines);
                                $iconData = json_encode($pull->SlotIcons);
                                $multiply = $pull->MultipyScatter;
                                $winLog = implode("\n", $pull->WinLogs);
                                $dropLineData = json_encode($pull->DropLineData);
                                $totalWay = $pull->TotalWay;
                                $winOnDrop = $pull->WinOnDrop;
                                $dropLine = $pull->DropLine;
                                $dropFeature = 0;
                                $MultipleList = $forceScatter ? json_encode($ssData->multiple_list) : json_encode($pull->MultipleList);
                                $transaction = generateRandomString();
                                $parentId = $ssData->parent_id ? $ssData->parent_id : 0;
                                insertSpinlogs($playerId, $gameName, $newFreeSpin, $baseBet, $betSize, $wallet, $cpl, $totalBet, $winAmount, $ActiveIcons, $ActiveLines, $iconData, $multiply, $winLog, $transaction, $dropLineData, $totalWay, $winOnDrop, $freeMode, $parentId, $dropLine, $MultipleList, $db);
                                $lastid = $db->lastInsertRowid();
                                if (!$freeMode && $forceScatter) {
                                    $ssData->parent_id = $lastid;
                                }
                                if ($newFreeSpin == 0) {
                                    $ssData->parent_id = 0;
                                    $ssData->free_spin_index = 0;
                                    $ssData->freespin = 0;
                                    // $ssData->multiple_list = "reset"; //Debug reset multiple
                                }
                                if ($parentId > 0 && $freeMode) {
                                    $dropNormal = DropNormal($db, $lastid);
                                    $dropFeature = DropFeature($db, $parentId);
                                    $dropFeature = $dropFeature + $dropNormal;

                                    $winAmountOld = WinAmountOld($db, $lastid);
                                    $winAmountNew = WinAmountNew($db, $parentId);
                                    $winAmount = $winAmountNew + $winAmountOld;
                                    $sql = <<<EOF
                                        UPDATE Spinlogs set drop_feature = $dropFeature, win_amount = $winAmount  Where id= $parentId;
                                        EOF;
                                    $db->exec($sql);
                                    // UpdateSpinlogs($dropFeature, $winAmount, $parentId, $db);
                                }
                                $ssData->multiple_list = json_Decode($MultipleList);
                                $sessionData = json_encode($ssData);
                                $sql = <<<EOF
                                    UPDATE SessionEntity set return_feature = $rtpFeature, return_normal = $rtpNormal, nextRun_feature= $nextRunFeature, session_data = '$sessionData'  Where session_id= '$session';
                                    EOF;
                                $db->exec($sql);
                                // UpdateSessionEntity($rtpFeature, $rtpNormal, $nextRunFeature, $sessionData, $db);
                                $resData = [
                                    'credit' => (float) number_format($wallet, 2, '.', ''),
                                    'freemode' => $freeMode,
                                    'jackpot' => 0,
                                    'free_spin' => $freeSpin,
                                    'free_num' => $newFreeSpin,
                                    'scaler' => 0,
                                    'num_line' => $baseBet,
                                    'betamount' => $betSize,
                                    'pull' => $pull,
                                ];
                                $success = true;
                            }
                        } else {
                            $errors[] = "Insufficient funds.";
                        }
                    } else {
                        $errors[] = "Invalid betsize or bet level.";
                    }
                } else {
                    $errors[] = "Game or Rule is not found.";
                }
            } else {
                $errors[] = "Session is not found.";
            }
        }

        if ($act === "histories") {
            $sort = array('spin_date' => 'DESC');
            $isFreeSpin = false;
            // $getHeader = getallheaders();
            // $session =  $getHeader['X-Ncash-token'];
            $session = SessionToken($db, $token, $gameName);
            if ($session) {
                $playerId = SessionPlayer($db, $session, $gameName);
                $totalBet = SumSpinlogs("total_bet", $db, $playerId, $gameName, $isFreeSpin);
                $totalWin = SumSpinlogs("win_amount", $db, $playerId, $gameName, $isFreeSpin);
                $totalProfit = $totalWin - $totalBet;
                $limit = 12;
                $page = $page ? $page : 1;
                $recorsPerPage = ($page - 1) * $limit;
                $paginate = Paginate($db, $gameName, $recorsPerPage, $limit);
                $totalRecord = SpinlogsCount($db, $gameName);
                $pageNumber = ceil($totalRecord / $limit);
                $resData = [
                    "totalRecord" => $totalRecord,
                    "totalPage" => $pageNumber,
                    "perPage" => $limit,
                    "currentPage" => $page,
                    "displayTotal" => $limit,
                    "totalBet" => $totalBet,
                    "totalWin" => (float) number_format($totalProfit, 2, '.', ''),
                    "totalProfit" => (float) number_format($totalProfit, 2, '.', ''),
                    "items" => $paginate
                ];
            } else {
                $msg = "session not found";
            }
        }

        if ($act === "history_detail") {
            $sort = array('spin_date' => 'DESC');
            $isFreeSpin = false;
            // $getHeader = getallheaders();
            // $session =  $getHeader['X-Ncash-token'];
            $session = SessionToken($db, $token, $gameName);
            if ($session) {
                $spinLogs = SpinLogsFind($db, $id, $gameName);
                $item =   [
                    $balance        = (float)$spinLogs['balance'],
                    $betSize        = $spinLogs['betamount'],
                    $betLevel       = $spinLogs['credit_line'],
                    "drop_feature"  => $spinLogs['drop_feature'],
                    "drop_normal"   => $spinLogs['drop_normal'],
                    $freeNum        = $spinLogs['free_num'],
                    "id"            => $spinLogs['id'],
                    $mutipy         = $spinLogs['multipy'],
                    "profit"        => $spinLogs['win_amount'] - $spinLogs['betamount'],
                    $spinDate       = (new DateTime($spinLogs['created_at']))->format('Y/m/d'),
                    $spinHour       = (new DateTime($spinLogs['created_at']))->format('H:i:s'),
                    $totalBet       = $spinLogs['total_bet'],
                    $totalWay       = $spinLogs['total_way'],
                    "transaction"   => $spinLogs['transaction_id'],
                    $winAmount      = (float)$spinLogs['win_amount'],
                    $iconData       = $spinLogs['icon_data'],
                    $dropLineData   = json_decode($spinLogs['drop_line']),
                    $transaction    = $spinLogs['transaction_id'],
                    $multiList      = json_decode($spinLogs['multiple_list']),
                    $totalWin       = $rospinLogsw['first_drop'],
                    $activeLines    = json_decode($spinLogs['active_lines']),
                ];
                $icons = $gameData->icons;
                $specialIcons = [];
                for ($i = 0; $i < count($icons); $i++) {
                    if ($icons[$i]['type'] == 3 || $icons[$i]['type'] == 5) {
                        $specialIcons[] = $icons[$i]['name'];
                    }
                }
                $log = (object) $item;
                $playerProfit = $winAmount - $totalBet;
                $rowNum = 3;
                $colNum = 5;
                $hasTopCol = false;
                if ($gameData->type == 8) {
                    $rowNum = 6;
                    $colNum = 6;
                    $hasTopCol = true;
                }

                if ($gameData->type == 9) {
                    $rowNum = 3;
                    $colNum = 3;
                }
                // $hasFreeSpin = $item->feature_in == 1;
                $hasFreeSpin = 1;

                $resultDisplay = [];
                // $iconData = $log->icon_data;
                //slide 1
                $reelData = [];
                $topReel = [];
                $i = 0;
                $rowStart = $hasTopCol ? 1 : 0;
                $iconData = json_Decode($iconData);
                if ($hasTopCol) {
                    for ($c = 0; $c < $colNum; $c++) {
                        $topReel[] = $iconData[$i];
                        $i++;
                    }
                }
                for ($r = $rowStart; $r < $rowNum; $r++) {
                    for ($c = 0; $c < $colNum; $c++) {
                        if (!isset($reelData[$c])) {
                            $reelData[$c] = [];
                        }
                        $rIndex = $hasTopCol ? $r - 1 : $r;
                        $reelData[$c][$rIndex] = $iconData[$i];
                        $i++;
                    }
                }
                $numDrop = !empty($dropLineData) ? count($dropLineData) : 0;
                $spinTitle = 'Normal Spin';
                $totalRound = $numDrop + 1;
                $roundName = $numDrop > 0 ? "Round 1/{$totalRound}" : "";
                $profit = $totalWin - $totalBet;
                $balance = $balance - $totalBet + $totalWin;
                $resultDisplay[] = (object) [
                    'transaction'   => $transaction,
                    'spin_title'    => $spinTitle,
                    'round_name'    => $roundName,
                    'bet_size'      => $betSize,
                    'bet_level'     => $betLevel,
                    'total_way'     => $totalWay,
                    'win_amount'    => (float) number_format($totalWin, 2, '.', ''),
                    'total_bet'     => (float) number_format($totalBet, 2, '.', ''),
                    'balance'       => (float) number_format($balance, 2, '.', ''),
                    'profit'        => (float) number_format($profit, 2, '.', ''),
                    'top_reel'      => $topReel,
                    'reel_data'     => $reelData,
                    'active_lines'  => $activeLines,
                    'multi_list'    => $multiList,
                ];
                $roundNum = 1;
                //slide history_detail
                $dropLine = $dropLineData;
                foreach ($dropLine as $item) {
                    $roundNum++;
                    $drop = (object) $item;
                    $iconData = $drop->SlotIcons;
                    $reelData = [];
                    $topReel = [];
                    $i = 0;
                    $rowStart = $hasTopCol ? 1 : 0;
                    if ($hasTopCol) {
                        for ($c = 0; $c < $colNum; $c++) {
                            $topReel[] = $iconData[$i];
                            $i++;
                        }
                    }
                    for ($r = $rowStart; $r < $rowNum; $r++) {
                        for ($c = 0; $c < $colNum; $c++) {
                            if (!isset($reelData[$c])) {
                                $reelData[$c] = [];
                            }
                            $rIndex = $hasTopCol ? $r - 1 : $r;
                            $reelData[$c][$rIndex] = $iconData[$i];
                            $i++;
                        }
                    }
                    $roundName = "Round {$roundNum}/{$totalRound}";
                    $totalBet = 0;
                    $totalWin = $drop->WinOnDrop;
                    $profit = $totalWin - $totalBet;
                    $balance = $balance - $totalBet + $totalWin;
                    $resultDisplay[] = (object) [
                        'transaction'   => $transaction,
                        'spin_title'    => $spinTitle,
                        'round_name'    => $roundName,
                        'bet_size'      => $betSize,
                        'bet_level'     => $betLevel,
                        'total_way'     => $drop->TotalWay,
                        'win_amount'    => (float) number_format($totalWin, 2, '.', ''),
                        'total_bet'     => (float) number_format($totalBet, 2, '.', ''),
                        'balance'       => (float) number_format($balance, 2, '.', ''),
                        'profit'        => (float) number_format($profit, 2, '.', ''),
                        'top_reel'      => $topReel,
                        'reel_data'     => $reelData,
                        'active_lines'  => $drop->ActiveLines,
                        'multi_list'    => $multiList,
                    ];
                }

                $items = [];
                $hasFreeSpin = true;
                if ($hasFreeSpin) {
                    $totalFreeSpin = $freeNum;
                    $select = $db->query('SELECT * FROM  Spinlogs WHERE parent_id= "' . $id . '" AND game_id = "' . $gameName . '" ORDER BY spin_date ASC ');
                    while ($row = $select->fetchArray()) {
                        // $aaa = $row['spin_date'];
                        $items[] =   [
                            "id" => $row['id'],
                            "spin_date" => $row['spin_date'],
                            "game_id" => $row['game_id'],
                            "player_id" => $row['player_id'],
                            "free_num" => $row['free_num'],
                            "num_line" => $row['num_line'],
                            "bet_amount" => $row['betamount'],
                            "balance" => $row['balance'],
                            "credit_line" => $row['credit_line'],
                            "total_bet" => $row['total_bet'],
                            "win_amount" => $row['win_amount'],
                            "active_icons" => $row['active_icons'],
                            "active_lines" => $row['active_lines'],
                            "icon_data" => $row['icon_data'],
                            "spin_ip" => $row['spin_ip'],
                            "created_at" => $row['created_at'],
                            "updated_at" => $row['updated_at'],
                            "multipy" => $row['multipy'],
                            "win_log" => $row['win_log'],
                            "transaction" => $row['transaction_id'],
                            "drop_line" => $row['drop_line'],
                            "total_way" => $row['total_way'],
                            "first_drop" => $row['first_drop'],
                            "is_free_spin" => $row['is_free_spin'],
                            "parent_id" => $row['parent_id'],
                            "drop_normal" => $row['drop_normal'],
                            "drop_feature" => $row['drop_feature'],
                            "mini_win" => $row['mini_win'],
                            "mini_result" => $row['mini_result'],
                            "multiple_list" => json_decode($row['multiple_list']),
                        ];
                    }
                    $countFreeSpin = 0;
                    foreach ($items as $item) {
                        $countFreeSpin++;
                        $sub = (object) $item;
                        // Log::debug(json_encode($sub));
                        $balanceBefore = number_format($sub->balance, 2);
                        $iconData = json_decode($sub->icon_data);
                        $reelData = [];
                        $topReel = [];
                        $i = 0;
                        $rowStart = $hasTopCol ? 1 : 0;
                        if ($hasTopCol) {
                            for ($c = 0; $c < $colNum; $c++) {
                                $topReel[] = $iconData[$i];
                                $i++;
                            }
                        }
                        for ($r = $rowStart; $r < $rowNum; $r++) {
                            for ($c = 0; $c < $colNum; $c++) {
                                if (!isset($reelData[$c])) {
                                    $reelData[$c] = [];
                                }
                                $rIndex = $hasTopCol ? $r - 1 : $r;
                                $reelData[$c][$rIndex] = $iconData[$i];
                                $i++;
                                $reelData[$c][$rIndex] = $iconData[$i];
                            }
                        }
                        $dropLine = json_decode($sub->drop_line);
                        $betSize    = (float) $sub->bet_amount;
                        $betLevel   = (int) $sub->credit_line;
                        $totalBet   = $sub->total_bet;
                        // $baseBet    = $sub->credit_line;
                        $numDrop = isset($sub->drop_line) ? count($dropLine) : 0;
                        $multiList = $sub->multiple_list;
                        $spinTitle = "Free Spin {$countFreeSpin}/{$totalFreeSpin}";
                        $totalRound = $numDrop + 1;
                        $roundName = $numDrop > 0 ? "Round 1/{$totalRound}" : "";
                        $transaction = $sub->transaction;
                        $totalBet = $sub->total_bet;
                        $totalWin = $sub->first_drop;
                        $profit = $totalWin - $totalBet;
                        $balance = $balance - $totalBet + $totalWin;
                        $resultDisplay[] = (object) [
                            'transaction'   => $transaction,
                            'spin_title'    => $spinTitle,
                            'round_name'    => $roundName,
                            'bet_size'      => $betSize,
                            'bet_level'     => $betLevel,
                            'total_way'     => $sub->total_way,
                            'win_amount'    => (float) number_format($totalWin, 2, '.', ''),
                            'total_bet'     => (float) number_format($totalBet, 2, '.', ''),
                            'profit'        => (float) number_format($profit, 2, '.', ''),
                            'balance'       => (float) number_format($balance, 2, '.', ''),
                            'top_reel'      => $topReel,
                            'reel_data'     => $reelData,
                            'active_lines'  => json_decode($sub->active_lines),
                            'multi_list'    => $multiList,
                        ];

                        $roundNum = 1;
                        foreach ($dropLine as $item) {
                            $roundNum++;
                            $drop = (object) $item;
                            $iconData = $drop->SlotIcons;
                            $reelData = [];
                            $topReel = [];
                            $i = 0;
                            $rowStart = $hasTopCol ? 1 : 0;
                            if ($hasTopCol) {
                                for ($c = 0; $c < $colNum; $c++) {
                                    $topReel[] = $iconData[$i];
                                    $i++;
                                }
                            }
                            for ($r = $rowStart; $r < $rowNum; $r++) {
                                for ($c = 0; $c < $colNum; $c++) {
                                    if (!isset($reelData[$c])) {
                                        $reelData[$c] = [];
                                    }
                                    $rIndex = $hasTopCol ? $r - 1 : $r;
                                    $reelData[$c][$rIndex] = $iconData[$i];
                                    $i++;
                                }
                            }
                            $roundName = "Round {$roundNum}/{$totalRound}";
                            $totalBet = 0;
                            $totalWin = $drop->WinOnDrop;
                            $profit = $totalWin - $totalBet;
                            $balance = $balance - $totalBet + $totalWin;
                            $resultDisplay[] = (object) [
                                'transaction'   => $transaction,
                                'spin_title'    => $spinTitle,
                                'round_name'    => $roundName,
                                'bet_size'      => $betSize,
                                'bet_level'     => $betLevel,
                                'total_way'     => $drop->TotalWay,
                                'win_amount'    => (float) number_format($totalWin, 2, '.', ''),
                                'total_bet'     => (float) number_format($totalBet, 2, '.', ''),
                                'profit'        => (float) number_format($profit, 2, '.', ''),
                                'balance'       => (float) number_format($balance, 2, '.', ''),
                                'top_reel'      => $topReel,
                                'reel_data'     => $reelData,
                                'active_lines'  => $drop->ActiveLines,
                                'multi_list'    => $multiList,
                            ];
                        }
                    }

                    $resData = (object) [
                        'has_feature'       => $hasFreeSpin,
                        'spin_date'         => $spinDate,
                        'spin_hour'         => $spinHour,
                        'transaction'       => $transaction,
                        'total_bet'         => (float) number_format($totalBet, 2, '.', ''),
                        'total_win'         => (float) number_format($totalWin, 2, '.', ''),
                        'free_num'          => $freeNum,
                        'multipy'           => $mutipy,
                        'credit_line'       => (float) number_format($betLevel, 2, '.', ''),
                        'profit'            => (float) number_format($playerProfit, 2, '.', ''),
                        'balance'           => (float) number_format($balance, 2, '.', ''),
                        'result_data'       => $resultDisplay,
                        'special_symbols'   => $specialIcons,
                        // 'multi_list'        => $log->multiple_list,
                    ];
                }
            } else {
                $msg = "session not found";
            }
        }

        if ($act === "buy") {
            $success = false;
            $betamount = isset($p->betamount) ? $p->betamount : null;
            $cpl = isset($p->cpl) ? $p->cpl : null;
            // $getHeader = getallheaders();
            // $token =  $getHeader['X-Ncash-token'];
            $session = SessionToken($db, $token, $gameName);
            if ($session) {
                $sessionsEntity = SessionEntity($db, $token);
                $ssData = json_decode($sessionsEntity['session_data']);
                $playerId = $sessionsEntity['player_id'];
                $nextRunFeature = $sessionsEntity['nextRun_feature'];
                $sRtpNormal = $sessionsEntity['return_normal'];
                $sRtpFeature = $sessionsEntity['return_feature'];
                $sessionId = $sessionsEntity['session_id'];
                $playerEntity = PlayerEntity($db, $playerId);
                $userName = $playerEntity['playerEntity'];
                $credit = $playerEntity['playerEntity'];
                $nextRunFeature = isset($nextRunFeature) ? $nextRunFeature : 0;
                $numFreeSpin = isset($ssData->freespin) ? $ssData->freespin : 0;
                $isContinuous = isset($ssData->multiply_continuous) ? $ssData->multiply_continuous : 0;
                $prevMultiply = isset($ssData->last_multiply) ? $ssData->last_multiply : 0;
                $freeMode = $numFreeSpin > 0 || $numFreeSpin == -1;
                $dataType = $freeMode ? 'feature' : 'normal';
                $spinData = spinConfig($path, $gameName, $dataType);
                if ($gameData && $gameRule && $spinData) {
                    $baseBet = (float)($gameData->credit_line);
                    if ($betamount && $cpl) {
                        $betSize = (float)$betamount;
                        $betLevel = (float)$cpl;
                        $featurePrice = !$freeMode ? floatval($gameData->buy_feature) : 0;
                        $ssData->betamount = $betSize;
                        $ssData->cpl = $betLevel;
                        $totalBet = $freeMode ? 0 : $baseBet * $betSize * $betLevel;
                        $buyAmount = $featurePrice ? $baseBet * $betSize * $betLevel * $featurePrice : 0;
                        $ajustRatio = $betSize * $betLevel;
                        $wallet = $credit;
                        if ($wallet > $buyAmount) {
                            $wallet = $wallet - $buyAmount;
                            $sql = <<<EOF
                                UPDATE PlayerEntity set credit = $wallet where id = $playerId;
                                EOF;
                            $db->exec($sql);
                            // UpdatePlayerEntity($wallet, $playerId, $db);
                            $fileName = '';
                            $lineIndex = 0;
                            $forceScatter = true; //Debug only
                            if ($forceScatter) {
                                $fileName = 'freespin_entry.txt';
                                $nextRunFeature = 0;
                            } else {
                                $maxWin = $freeMode ? $rtpFeature / $ajustRatio : $rtpNormal / $ajustRatio;
                                $maxWin = $maxWin > 0 ? $maxWin : 0;
                                $winData = [];
                                for ($i = 0; $i < count($spinData); $i++) {
                                    $spin = (object) $spinData[$i];
                                    if ($spinData[$i]['win'] <= $maxWin) {
                                        $count = (int) $spinData[$i];
                                        while ($count > 0) {
                                            $winData[] = $spinData[$i]['win'];
                                            $count--;
                                        }
                                    }
                                }
                                $forceWin = $winData[array_rand($winData)];
                                for ($i = 0; $i < count($spinData); $i++) {
                                    $win =  $spinData[$i]['win'];
                                    if ($win == $forceWin) {
                                        $fileName = $spinData[$i]['file'];
                                        $count = (int)$spinData[$i]['count'];
                                        $lineIndex = rand(1, $count);
                                    }
                                }
                            }
                            $pull = spinConfigData($path, $gameName, $fileName, $lineIndex, $dataType);
                            if ($pull) {
                                if ($freeMode && $isContinuous) {
                                    $totalWin = 0;
                                    $ajustWin = 0;
                                    $pull->LastMultiply = $pull->LastMultiply + $prevMultiply;
                                    for ($i = 0; $i < count($pull->ActiveLines); $i++) {
                                        $pull->ActiveLines[$i]->multiply = $pull->ActiveLines[$i]->multiply + $prevMultiply;
                                        $ajustMultiRatio = ($pull->ActiveLines[$i]->multiply + $prevMultiply) / $pull->ActiveLines[$i]->multiply;
                                        $pull->ActiveLines[$i]->win_amount = (float) number_format($pull->ActiveLines[$i]->win_amount * $ajustMultiRatio, 2, '.', '');
                                        $ajustWin = (float) number_format($ajustWin + $pull->ActiveLines[$i]->win_amount, 2, '.', '');
                                    }
                                    $pull->WinOnDrop = $ajustWin;
                                    $totalWin = $totalWin + $ajustWin;

                                    for ($d = 0; $d < count($pull->DropLineData); $d++) {
                                        $ajustWin = 0;
                                        for ($i = 0; $i < count($pull->DropLineData[$d]->ActiveLines); $i++) {
                                            $pull->DropLineData[$d]->ActiveLines[$i]->multiply = $pull->DropLineData[$d]->ActiveLines[$i]->multiply + $prevMultiply;
                                            $ajustMultiRatio = ($pull->DropLineData[$d]->ActiveLines[$i]->multiply + $prevMultiply) / $pull->DropLineData[$d]->ActiveLines[$i]->multiply;
                                            $pull->DropLineData[$d]->ActiveLines[$i]->win_amount = (float) number_format($pull->DropLineData[$d]->ActiveLines[$i]->win_amount * $ajustMultiRatio, 2, '.', '');
                                            $ajustWin = $ajustWin + $pull->DropLineData[$d]->ActiveLines[$i]->win_amount;
                                        }
                                        $pull->DropLineData[$d]->DropLineData = $ajustWin;
                                        $totalWin = $totalWin + $ajustWin;
                                    }
                                    $pull->WinAmount = $totalWin;
                                }
                                // Ajust betsize & level ratio (basic data is 1:1)
                                $pull->WinAmount = (float) number_format($pull->WinAmount * $ajustRatio, 2, '.', '');
                                $pull->WinOnDrop = (float) number_format($pull->WinOnDrop * $ajustRatio, 2, '.', '');
                                for ($i = 0; $i < count($pull->ActiveLines); $i++) {
                                    $pull->ActiveLines[$i]->win_amount = (float) number_format($pull->ActiveLines[$i]->win_amount * $ajustRatio, 2, '.', '');
                                }
                                for ($i = 0; $i < count($pull->DropLineData); $i++) {
                                    $pull->DropLineData[$i]->WinOnDrop = (float) number_format($pull->DropLineData[$i]->WinOnDrop * $ajustRatio, 2, '.', '');
                                    for ($j = 0; $j < count($pull->DropLineData[$i]->ActiveLines); $j++) {
                                        $pull->DropLineData[$i]->ActiveLines[$j]->win_amount = (float) number_format($pull->DropLineData[$i]->ActiveLines[$j]->win_amount * $ajustRatio, 2, '.', '');
                                    }
                                }
                                $winAmount = $pull->WinAmount;
                                if ($winAmount > 0) {
                                    $wallet = $wallet + $winAmount;
                                    $sql = <<<EOF
                                        UPDATE PlayerEntity set credit = $wallet where id = $playerId;
                                        EOF;
                                    $db->exec($sql);
                                    // UpdatePlayerEntity($wallet, $playerId, $db);
                                    if ($freeMode) {
                                        $rtpFeature = $rtpFeature - $winAmount;
                                    } else {
                                        $rtpNormal = $rtpNormal - $winAmount;
                                    }
                                }
                                if ($freeMode && $isContinuous) {
                                    $ssData->last_multiply = $pull->LastMultiply;
                                }
                                if (!$freeMode) {
                                    $nextRunFeature = $nextRunFeature + 1;
                                }
                                $newFreeSpin = $freeMode ? $numFreeSpin - 1 : $pull->FreeSpin;
                                $ssData->freespin = $newFreeSpin;
                                $freeSpin = $newFreeSpin > 0 || $newFreeSpin == -1 ? 1 : 0;
                                if ($freeMode && $newFreeSpin == 0) {
                                    $ssData->last_multiply = 0;
                                }

                                $WinLogs = implode("\n", $pull->WinLogs);
                                $ActiveIcons = json_encode($pull->ActiveIcons);
                                $ActiveLines = json_encode($pull->ActiveLines);
                                $iconData = json_encode($pull->SlotIcons);
                                $multiply = $pull->MultipyScatter;
                                $winLog = implode("\n", $pull->WinLogs);
                                $dropLineData = json_encode($pull->DropLineData);
                                $totalWay = $pull->TotalWay;
                                $winOnDrop = $pull->WinOnDrop;
                                $dropLine = $pull->DropLine;
                                $dropFeature = 0;
                                $MultipleList = json_encode($pull->MultipleList);
                                $transaction = generateRandomString();
                                $parentId = $ssData->parent_id ? $ssData->parent_id : 0;
                                insertSpinlogs($playerId, $gameName, $newFreeSpin, $baseBet, $betSize, $wallet, $cpl, $totalBet, $winAmount, $ActiveIcons, $ActiveLines, $iconData, $multiply, $winLog, $transaction, $dropLineData, $totalWay, $winOnDrop, $freeMode, $parentId, $dropLine, $MultipleList, $db);
                                $lastid = $db->lastInsertRowid();
                                if (!$freeMode && $forceScatter) {
                                    $ssData->parent_id = $lastid;
                                }
                                if ($newFreeSpin == 0) {
                                    $ssData->parent_id = 0;
                                }
                                if ($parentId > 0 && $freeMode) {
                                    $dropNormal = DropNormal($db, $lastid);
                                    $dropFeature = DropFeature($db, $parentId);
                                    $dropFeature = $dropFeature + $dropNormal;

                                    $winAmountOld = WinAmountOld($db, $lastid);
                                    $winAmountNew = WinAmountNew($db, $parentId);
                                    $winAmount = $winAmountNew + $winAmountOld;
                                    $sql = <<<EOF
                                        UPDATE Spinlogs set drop_feature = $dropFeature, win_amount = $winAmount  Where id= $parentId;
                                        EOF;
                                    $db->exec($sql);
                                    // UpdateSpinlogs($dropFeature, $winAmount, $parentId, $db);
                                }
                                $playerId = SessionToken($db, $token, $gameName);
                                $sessionData = json_encode($ssData);
                                $sql = <<<EOF
                                    UPDATE SessionEntity set session_data = '$sessionData'  Where session_id= '$session';
                                    EOF;
                                $db->exec($sql);
                                // UpdateSessionData($sessionData, $session, $db);
                                $resData = [
                                    'credit' => (float) number_format($wallet, 2, '.', ''),
                                    'freemode' => $freeMode,
                                    'jackpot' => 0,
                                    'free_spin' => $freeSpin,
                                    'free_num' => $newFreeSpin,
                                    'scaler' => 0,
                                    'num_line' => $baseBet,
                                    'betamount' => $betSize,
                                    'pull' => $pull,
                                ];
                                $success = true;
                            }
                        } else {
                            $errors[] = "Insufficient funds.";
                        }
                    } else {
                        $errors[] = "Invalid betsize or bet level.";
                    }
                } else {
                    $errors[] = "Game or Rule is not found.";
                }
            } else {
                $errors[] = "Session is not found.";
            }
        }

        if ($act === "change_free") {
            $success = false;
            $betamount = isset($p->betamount) ? $p->betamount : null;
            $cpl = isset($p->cpl) ? $p->cpl : null;
            // $getHeader = getallheaders();
            // $token =  $getHeader['X-Ncash-token'];
            $session = SessionToken($db, $token, $gameName);
            if ($session) {
                $ssData = SessionData($db, $token, $gameName);
                $select = $ssData->multiply_select;
                for ($i = 0; $i < count($select); $i++) {
                    if ($select[$i]->index == $index) {
                        $resData  = [
                            "free_num" => $select[$i]->free_num
                        ];
                        $multiList = [(int)$select[$i]->multiply_1, (int)$select[$i]->multiply_2, (int)$select[$i]->multiply_3, (int)$select[$i]->multiply_4];
                        $ssData->free_spin_index = $index;
                        $ssData->freespin = $select[$i]->free_num;
                        $ssData->freespin_mode = $index;
                        $ssData->multiple_list = $multiList;
                        $freeNum = $ssData->freespin;
                        $id =  $ssData->parent_id;
                        $ssData = json_encode($ssData);
                        $sql = <<<EOF
                            UPDATE SessionEntity set session_data = '$sessionData'  Where session_id= '$session';
                            EOF;
                        $db->exec($sql);
                        // UpdateSessionData($sessionData, $session, $db);
                        SetFreeNum($freeNum, $id, $db);
                        $success = true;
                    }
                }
                if ($success == false) {
                    $errors[] = 'Free spin index is not found';
                }
            } else {
                $errors[] = "Session is not found.";
            }
        }
    } else {
        $errors[] = "empty DB";
    }
    $db->close();
} else {
    $errors[] = 'Empty action';
}





if (count($errors) > 0) {
    $success = false;
}
$apidata->message = implode("; ", $errors);
$apidata->success = $success;
$apidata->data = $resData;

echo json_encode($apidata);

function generateRandomString($length = 10)
{
    $characters = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    $charactersLength = strlen($characters);
    $randomString = '';
    for ($i = 0; $i < $length; $i++) {
        $randomString .= $characters[random_int(0, $charactersLength - 1)];
    }
    return $randomString;
}

function spinConfigData($path, $gameName, $fileName, $lineNum = 0, $type = 'normal')
{
    $res = null;
    $spinConfigFolder = $type . "__spin";
    $privatePath = $fileName == "freespin_entry.txt" ? "$path/$gameName/$fileName" : "$path/$gameName/$spinConfigFolder/$fileName";
    if ($privatePath) {
        $fileContent = file_get_contents($privatePath);
        $spArr = preg_split("/[\n]/", $fileContent);
        $lIndex = $lineNum > 0 ? $lineNum - 1 : array_rand($spArr);
        if ($spArr[$lIndex]) {
            $strData = base64_decode($spArr[$lIndex]);
            $res = json_decode($strData);
        }
    }
    return $res;
}

function spinConfig($path, $gameName, $type = "normal")
{
    $res = null;
    $spinConfigName = $type . "__spin.json";
    $spinConfigFolder = $type . "__spin";
    $privatePath = "$path/$gameName/$spinConfigName";
    if (file_exists($privatePath)) {
        $spinContent = file_get_contents("$path/$gameName/$spinConfigName");
        $res = json_decode($spinContent, true);
    } else {
        $res = [];
        $folderPath = "$path/$gameName/$spinConfigFolder/";
        $spinFilePath = scandir($folderPath);
        for ($i = 2; $i < count($spinFilePath); $i++) {
            $fileName = $spinFilePath[$i];
            $fileContent = file_get_contents($folderPath . "/" . $fileName);
            $count = count(preg_split("/[\n]/", $fileContent)) - 1;
            $nameArr = preg_split("/[_]/", $fileName);
            $win = (float)$nameArr[2];
            $res[] =  [
                "win" => $win,
                "count" => $count,
                "file" => $fileName
            ];
        }
        $fh = fopen($privatePath, 'w');
        fwrite($fh, json_encode($res));
        fclose($fh);
    }
    return $res;
}

function SetFreeNum($freeNum, $id, $db)
{
    $sql = <<<EOF
        UPDATE Spinlogs set free_num = '$freeNum'  Where id= '$id';
        EOF;
    $db->exec($sql);
}

function PlayerEntityId($db, $userName)
{
    $playerId = $db->querySingle('SELECT id FROM PlayerEntity WHERE user_name= "' . $userName . '"');
    return $playerId;
}

function SessionPlayerId($db, $playerId, $gameName)
{
    $sessionId = $db->querySingle('SELECT session_id FROM SessionEntity WHERE player_id= "' . $playerId . '" AND game_name = "' . $gameName . '"');
    return $sessionId;
}

function SessionToken($db, $token, $gameName)
{
    $session = $db->querySingle('SELECT session_id FROM  SessionEntity WHERE session_id= "' . $token . '"AND game_name= "' . $gameName . '"');
    return $session;
}

function SessionData($db, $token, $gameName)
{
    $ssData = json_decode($db->querySingle('SELECT session_data FROM  SessionEntity WHERE session_id= "' . $token . '" AND game_name= "' . $gameName . '"'));
    return $ssData;
}

function SessionId($db, $token)
{
    $sessionId = $db->querySingle('SELECT session_id FROM SessionEntity WHERE session_id= "' . $token . '"');
    return $sessionId;
}

function SessionPlayer($db, $session, $gameName)
{
    $playerId = $db->querySingle('SELECT player_id FROM  SessionEntity WHERE session_id= "' . $session . '" AND game_name= "' . $gameName . '" ');
    return $playerId;
}

function SessionEntity($db, $token)
{
    $sessions = $db->query('SELECT * FROM  SessionEntity WHERE session_id= "' . $token . '"');
    while ($row = $sessions->fetchArray()) {
        return $row;
    }
}

function PlayerEntity($db, $playerId)
{
    $players = $db->query('SELECT * FROM PlayerEntity Where id= "' . $playerId . '"');
    while ($row = $players->fetchArray()) {
        return $row;
    }
}

function DropNormal($db, $lastid)
{
    $dropNormal = $db->querySingle('SELECT drop_normal FROM  Spinlogs WHERE id= "' . $lastid . '" ');
    return $dropNormal;
}

function DropFeature($db, $parentId)
{
    $dropFeature = $db->querySingle('SELECT drop_feature FROM  Spinlogs WHERE id= "' . $parentId . '" ');
    return $dropFeature;
}

function WinAmountOld($db, $lastid)
{
    $winAmountOld = $db->querySingle('SELECT win_amount FROM  Spinlogs WHERE id= "' . $lastid . '" ');
    return $winAmountOld;
}

function UpdateSpinlogs($dropFeature, $winAmount, $parentId, $db)
{
    $sql = <<<EOF
        UPDATE Spinlogs set drop_feature = $dropFeature, win_amount = $winAmount  Where id= $parentId;
        EOF;
    $db->exec($sql);
}

function UpdateSessionEntity($rtpFeature, $rtpNormal, $nextRunFeature, $sessionData, $db)
{
    $sql = <<<EOF
        UPDATE SessionEntity set return_feature = $rtpFeature, return_normal = $rtpNormal, nextRun_feature= $nextRunFeature, session_data = '$sessionData'  Where session_id= '$session';
        EOF;
    $db->exec($sql);
}

function UpdateSessionData($sessionData, $session, $db)
{
    $sql = <<<EOF
        UPDATE SessionEntity set session_data = '$sessionData'  Where session_id= '$session';
        EOF;
    $db->exec($sql);
}

function WinAmountNew($db, $parentId)
{
    $winAmountNew = $db->querySingle('SELECT win_amount FROM  Spinlogs WHERE id= "' . $parentId . '" ');
    return $winAmountNew;
}

function SumSpinlogs($total, $db, $playerId, $gameName, $isFreeSpin)
{
    $total = $db->querySingle("SELECT SUM($total) FROM  Spinlogs WHERE  player_id = '" . $playerId . "' AND game_id= '" . $gameName . "'AND is_free_spin = '$isFreeSpin' AND parent_id = 0");
    return $total;
}

function SpinlogsOrder($db, $gameName, $recorsPerPage, $limit)
{
    $ret = $db->query("SELECT * FROM Spinlogs WHERE game_id= '" . $gameName . "' AND parent_id = 0 ORDER BY created_at desc LIMIT $recorsPerPage, $limit");
    while ($row = $ret->fetchArray()) {
        return $row;
    }
}

function Paginate($db, $gameName, $recorsPerPage, $limit)
{
    $ret = $db->query("SELECT * FROM Spinlogs WHERE game_id= '" . $gameName . "' AND parent_id = 0 ORDER BY created_at desc LIMIT $recorsPerPage, $limit");
    while ($row = $ret->fetchArray()) {
        $paginate[] =   [
            "balance"       => (float) number_format($row['balance'], 2, '.', ''),
            "bet_amount"    => $row['betamount'],
            "credit_line"   => $row['credit_line'],
            "drop_feature"  => $row['drop_feature'],
            "drop_normal"   => $row['drop_normal'],
            "free_num"      => $row['free_num'],
            "id"            => $row['id'],
            "multipy"       => $row['multipy'],
            "profit"        => (float) number_format($row['win_amount'] - $row['total_bet'], 2, '.', ''),
            "spin_date"     => (new DateTime($row['created_at']))->format('d/m'),
            "spin_hour"     => (new DateTime($row['created_at']))->format('H:i:s'),
            "total_bet"     => $row['total_bet'],
            "total_way"     => $row['total_way'],
            "transaction"   => $row['transaction_id'],
            "win_amount"    => (float) number_format($row['win_amount'], 2, '.', ''),
            "parent_id"     => $row['parent_id'],
        ];
    }
    return $paginate;
}

function SpinLogsFind($db, $id, $gameName)
{
    $items = $db->query('SELECT * FROM  Spinlogs WHERE id = "' . $id . '" AND game_id = "' . $gameName . '" ');
    while ($row = $items->fetchArray()) {
        return $row;
    }
}

function SpinlogsCount($db, $gameName)
{
    $count = $db->querySingle("SELECT COUNT(id) FROM Spinlogs WHERE game_id= '" . $gameName . "'");
    return $count;
}

function UpdatePlayerEntity($wallet, $playerId, $db)
{
    $sql = <<<EOF
        UPDATE PlayerEntity set credit = $wallet where id = $playerId;
        EOF;
    $db->exec($sql);
}

function createPlayerEntity($db)
{
    $sql = <<<EOF
            CREATE TABLE IF NOT EXISTS PlayerEntity
            (id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_name              STRING      ,
            credit                DECIMAL(8,2));
        EOF;
    $db->query($sql);
}

function insertPlayerEntity($userName, $wallet, $db)
{
    $sql = <<<EOF
                INSERT OR IGNORE INTO PlayerEntity (user_name,credit)
                VALUES ("$userName", "$wallet");
                EOF;
    $db->exec($sql);
}

function createSessionEntity($db)
{
    $sql = <<<EOF
            CREATE TABLE IF NOT EXISTS SessionEntity
            (id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id              STRING     ,
            game_name               STRING,
            session_data            JSON,
            player_id               INTEGER,
            system_profit           DECIMAL(8,2),
            return_normal           DECIMAL(8,2),
            return_feature          DECIMAL(8,2),
            nextRun_feature         NUMBER);
        EOF;
    $db->query($sql);
}

function insertSessionEntity($playerId, $gameName, $token, $sessionData, $SIGNUP_BONUS, $db)
{
    $sql = <<<EOF
        INSERT OR IGNORE INTO SessionEntity (player_id,game_name,session_id,session_data,return_normal)
        VALUES ("$playerId","$gameName","$token",'$sessionData',"$SIGNUP_BONUS");
        EOF;
    $db->exec($sql);
}

function createSpinlogs($db)
{
    $sql = <<<EOF
            CREATE TABLE IF NOT EXISTS Spinlogs
            (id                     INTEGER PRIMARY KEY AUTOINCREMENT,
            spin_date               TEXT,
            game_id                 STRING,
            player_id               INTEGER,
            free_num                INTEGER,
            num_line                INTEGER,
            betamount               DECIMAL(8,2),
            balance                 DECIMAL(18,2),
            credit_line             DECIMAL(4,2),
            total_bet               DECIMAL(8,2),
            win_amount              DECIMAL(8,2),
            active_icons            TEXT    ,
            active_lines            TEXT,
            icon_data               TEXT,
            spin_ip                 TEXT    ,
            created_at              INTEGER,
            updated_at              INTEGER,
            multipy                 INTEGER,
            win_log                 TEXT    ,
            transaction_id          TEXT,
            drop_line               TEXT    ,
            total_way               INTEGER,
            first_drop              DECIMAL(8,2),
            is_free_spin            INTEGER,
            parent_id               TEXT,
            drop_normal             INTEGER,
            drop_feature            INTEGER,
            mini_win                DECIMAL(8,2),
            mini_result             TEXT,
            multiple_list           TEXT);
        EOF;
    $db->query($sql);
}

function insertSpinlogs($playerId, $gameName, $newFreeSpin, $baseBet, $betSize, $wallet, $cpl, $totalBet, $winAmount, $ActiveIcons, $ActiveLines, $iconData, $multiply, $winLog, $transaction, $dropLineData, $totalWay, $winOnDrop, $freeMode, $parentId, $dropLine, $MultipleList, $db)
{
    $sql = <<<EOF
            INSERT INTO Spinlogs (
            spin_date,
            player_id,
            game_id,
            free_num,
            num_line,
            betamount,
            balance,
            credit_line,
            total_bet,
            win_amount,
            active_icons,
            active_lines,
            icon_data,
            spin_ip,
            created_at,
            updated_at,
            multipy,
            win_log,
            transaction_id,
            drop_line,
            total_way,
            first_drop,
            is_free_spin,
            parent_id,
            drop_normal,
            drop_feature,
            mini_win,
            mini_result,
            multiple_list)

            VALUES (
            datetime('now', '+7 hours'),
            $playerId,
            "$gameName",
            $newFreeSpin,
            $baseBet,
            $betSize,
            $wallet,
            $cpl,
            $totalBet,
            $winAmount,
            '$ActiveIcons',
            '$ActiveLines',
            '$iconData',
            "spin_ip",
            datetime('now', '+7 hours'),
            datetime('now', '+7 hours'),
            $multiply,
            '$winLog',
            "$transaction",
            '$dropLineData',
            $totalWay,
            $winOnDrop,
            '$freeMode',
            $parentId,
            $dropLine,
            0,
            "mini_win",
            "mini_result",
            '$MultipleList');
            EOF;
    $db->exec($sql);
}
