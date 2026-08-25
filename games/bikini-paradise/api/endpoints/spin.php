<?php
if ($_SERVER['REQUEST_METHOD'] != "POST") die("a");

$qUser = Q("SELECT * FROM usuarios WHERE usuario='$token'");
$user = $qUser->fetch_assoc();
if (!$user) die("User not found");



$freeMode = rand(1, 10) == 1;
$freeSpin = rand(1, 20) == 1;
$freeNum = rand(1, 8) == 1;
$freeNum = false;
define("SLOTINCONS", 0);
define("ACTIVEICONS", 1);
define("ACTIVELINES", 2);
define("DROPLINEDATA", 3);
define("MULTIPLYCOUNT", 4);
define("PAYOUT", 5);
define("FREESPIN", 6);
define("FEATURESYMBOL", 7);

// SlotIcons, ActiveIcons, ActiveLines, DropLineData, MultiplyCount, Payout
$loseResults = [
    [
        [
            "Symbol_2",
            "Symbol_7",
            "Symbol_9",
            "Symbol_10",
            "Symbol_4",
            "Symbol_6",
            "Symbol_5",
            "Symbol_0:3:1",
            "Symbol_5",
            "Symbol_3",
            "Symbol_3",
            "Symbol_10",
            "_skip",
            "Symbol_0:2:1",
            "Symbol_3",
            "Symbol_7",
            "Symbol_8",
            "_skip",
            "_skip",
            "Symbol_7",
        ],
        [],
        [],
        [],
        1,
        0,
    ],
    [
        [
            "Symbol_6",
            "Symbol_5",
            "Symbol_8",
            "Symbol_3",
            "Symbol_8",
            "Symbol_3",
            "Symbol_4",
            "Symbol_8",
            "Symbol_6",
            "Symbol_9",
            "Symbol_8",
            "Symbol_6",
            "Symbol_2",
            "Symbol_6",
            "Symbol_10",
            "Symbol_10",
            "Symbol_2",
            "Symbol_6",
            "Symbol_4",
            "Symbol_8",
        ],
        [],
        [],
        [],
        1,
        0,
    ],
    [
        [
            "Symbol_9",
            "Symbol_6",
            "Symbol_10",
            "Symbol_0:1:0",
            "Symbol_0:2:0",
            "Symbol_9",
            "Symbol_9",
            "Symbol_8",
            "Symbol_9",
            "_skip",
            "Symbol_10",
            "Symbol_7",
            "Symbol_5",
            "Symbol_9",
            "Symbol_5",
            "Symbol_5",
            "Symbol_6",
            "Symbol_4",
            "Symbol_7",
            "Symbol_5",
        ],
        [],
        [],
        [],
        1,
        0,
    ],
    [
        [
            "Symbol_3",
            "Symbol_4",
            "Symbol_9",
            "Symbol_5",
            "Symbol_4",
            "Symbol_10",
            "Symbol_10",
            "Symbol_8",
            "Symbol_4",
            "Symbol_2",
            "Symbol_8",
            "Symbol_3",
            "Symbol_6",
            "Symbol_8",
            "Symbol_6",
            "Symbol_10",
            "Symbol_3",
            "Symbol_5",
            "Symbol_3",
            "Symbol_6",
        ],
        [],
        [],
        [],
        1,
        0,
    ],
    [
        [
            "Symbol_6",
            "Symbol_8",
            "Symbol_0:1:0",
            "Symbol_9",
            "Symbol_6",
            "Symbol_5",
            "Symbol_4",
            "Symbol_6",
            "Symbol_5",
            "Symbol_2",
            "Symbol_2",
            "Symbol_3",
            "Symbol_6",
            "Symbol_6",
            "Symbol_5",
            "Symbol_10",
            "Symbol_3",
            "Symbol_10",
            "Symbol_8",
            "Symbol_7",
        ],
        [],
        [],
        [],
        1,
        0,
    ],
    [
        [
            "Symbol_9",
            "Symbol_3",
            "Symbol_5",
            "Symbol_6",
            "Symbol_5",
            "Symbol_7",
            "Symbol_4",
            "Symbol_7",
            "Symbol_0:3:1",
            "Symbol_7",
            "Symbol_7",
            "Symbol_4",
            "Symbol_2",
            "_skip",
            "Symbol_5",
            "Symbol_4",
            "Symbol_3",
            "Symbol_9",
            "_skip",
            "Symbol_6",
        ],
        [],
        [],
        [],
        1,
        0,
    ],
];

// SlotIcons, ActiveIcons, ActiveLines, DropLineData, MultiplyCount, Payout
$winResults = [
    [
        [
            "Symbol_8",
            "Symbol_2",
            "Symbol_10",
            "Symbol_10",
            "Symbol_0:1:0",
            "Symbol_9",
            "Symbol_4",
            "Symbol_8",
            "Symbol_8",
            "Symbol_2",
            "Symbol_3",
            "Symbol_6",
            "Symbol_3",
            "Symbol_6",
            "Symbol_2",
            "Symbol_6",
            "Symbol_9",
            "Symbol_6",
            "Symbol_9",
            "Symbol_10",
        ],

        [16, 12, 18, 14],
        [
            [
                "index" => 10,
                "name" => "Symbol_6",
                "combine" => 3,
                "way_243" => 1,
                "multiply" => 0,
                "win_amount" => 0,
                "active_icon" => [16, 12, 18, 14],
            ],
        ],
        [],
        1,
        60,
    ],

    [
        [
            "Symbol_9",
            "Symbol_8",
            "Symbol_8",
            "Symbol_9",
            "Symbol_6",
            "Symbol_10",
            "Symbol_10",
            "Symbol_4",
            "Symbol_6",
            "Symbol_2",
            "Symbol_6",
            "Symbol_7",
            "Symbol_10",
            "Symbol_4",
            "Symbol_3",
            "Symbol_5",
            "Symbol_10",
            "Symbol_8",
            "Symbol_3",
            "Symbol_7",
        ],

        [6, 7, 13],
        [
            [
                "index" => 12,
                "name" => "Symbol_10",
                "combine" => 3,
                "way_243" => 1,
                "multiply" => 0,
                "win_amount" => 0,
                "active_icon" => [6, 7, 13],
            ],
        ],
        [],
        1,
        30,
    ],
    [
        [
            "Symbol_5",
            "Symbol_3",
            "Symbol_3",
            "Symbol_2",
            "Symbol_2",
            "Symbol_3",
            "Symbol_2",
            "Symbol_7",
            "Symbol_3",
            "Symbol_6",
            "Symbol_5",
            "Symbol_6",
            "Symbol_3",
            "Symbol_3",
            "Symbol_2",
            "Symbol_4",
            "Symbol_6",
            "Symbol_6",
            "Symbol_4",
            "Symbol_5",
        ],

        [6, 2, 3],
        [
            [
                "index" => 19,
                "name" => "Symbol_3",
                "combine" => 3,
                "way_243" => 1,
                "multiply" => 0,
                "win_amount" => 0,
                "active_icon" => [6, 2, 3],
            ],
        ],
        [],
        1,
        15,
    ],
    [
        [
                "Symbol_9",
                "Symbol_10",
                "Symbol_0:1:0",
                "Symbol_7",
                "Symbol_6",
                "Symbol_7",
                "Symbol_9",
                "Symbol_6",
                "Symbol_3",
                "Symbol_0:3:1",
                "Symbol_2",
                "Symbol_3",
                "Symbol_6",
                "Symbol_5",
                "_skip",
                "Symbol_10",
                "Symbol_5",
                "Symbol_2",
                "Symbol_8",
                "_skip"
        ],

        [  1,
                7,
                3],
        [
            [
                "index" => 5,
                "name" => "Symbol_9",
                "combine" => 3,
                "way_243" => 1,
                "multiply" => 0,
                "win_amount" => 0,
                "active_icon" => [  1,
                7,
                3],
            ],
        ],
        [],
        1,
        10,
    ],
];

//////////////////////////// COMMON /////////////////////////////////////////
// Just after results array declaration

shuffle($winResults);
shuffle($loseResults);

if ($user["demo_account"]) {
    $loseLength = 1;
    $winLength = 20;
} else {
    $winLength = 2;
    $loseLength = 20;
}

$winResults = array_slice($winResults, 0, $winLength);
$loseResults = array_slice($loseResults, 0, $loseLength);

$possibleResults = array_merge($winResults, $loseResults);
shuffle($possibleResults);
$result = $possibleResults[0];

///////////////////////////////////////////////////////////////////////////

$cpl = intval($_POST["cpl"]);
$amount = floatval($_POST["betamount"]);
$numline = intval($_POST["numline"]);
$bet = $amount * $cpl * $numline;

/////////////////////////////// COMMOM /////////////////////////////////
// Just after $bet declaration

if ($user["saldo"] + $user["bonus"] < $bet) {
    die("Insuficient credits");
} else {
    if ($user["saldo"] >= $bet) {
        $query = "UPDATE usuarios SET saldo=saldo-$bet WHERE usuario='$token'";
    } else {
        $query = "UPDATE usuarios SET saldo=0 WHERE usuario='$token'";
        $disc = $bet - $user["saldo"];
        Q("UPDATE usuarios SET bonus=$disc WHERE usuario='$token'");
    }
}

Q($query);

// To $winAmount declaration
///////////////////////////////////////////////////////////////////////

$winAmount = $cpl * $amount * $result[PAYOUT];

if ($winAmount > 0) {
    $result[ACTIVELINES][0]["win_amount"] = $winAmount;
    $result[ACTIVELINES][0]["payout"] = $result[PAYOUT];
}
Q("UPDATE usuarios SET saldo=saldo+$winAmount WHERE usuario='$token'");

$qUser = Q("SELECT * FROM usuarios WHERE usuario='$token'");
$user = $qUser->fetch_assoc();

$pull = [
    "WinAmount" => $winAmount,
    "WinOnDrop" => $winAmount,
    "TotalWay" => 27,
    "FreeSpin" => $result[FREESPIN] * -1,
    "LastMultiply" => 0,
    "WildFixedIcons" => [],
    "HasJackpot" => false,
    "HasScatter" => false,
    "CountScatter" => 0,
    "WildColumIcon" => "",
    "MultipyScatter" => 0,
    "MultiplyCount" => 2,
    "SlotIcons" => $result[0],
    "ActiveIcons" => $result[1],
    "ActiveLines" => $result[2],
    "WinLogs" => [
        "[BET] betLevel: 10, betSize:10, baseBet:20.00 => 2000",
        "[WIN] line 1: 4[Symbol_5] payout: 25 (*multipy:1) x 10 x 10 => 2500",
    ],
    "DropLine" => 3,
    "DropLineData" => $result[3],
    "MultipleList" => [1, 2, 3, 5],
];

$data = [
    "credit" => $user["saldo"] + $user["bonus"],
    "freemode" => true,
    "jackpot" => 0,
    "free_spin" => 0,
    "free_num" => $freeNum,
    "scaler" => 0,
    "num_line" => $_POST["numline"],
    "cpl" => $cpl,
    "betamount" => $amount,
    "bet_amount" => $bet,
    "pull" => $pull,
];

S("success", true);
S("data", $data);
S("message", "Spin success");
R();
