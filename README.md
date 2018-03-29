
//small blind
curl -X POST -H 'Content-Type: application/json' -H 'Authorization: eyJ0eXBlIjoiRVdUIiwiYWxnIjoiRVMyNTZrIn0.eyJiZXQiOlt7InVpbnQxMzYiOjB9LHsidWludDExMiI6NTAwMH1dLCJ2IjowfQ.QSUHko5AN6jFMRYwZFISPZsTWC6a8f7wxR28OcQaalprbEVnV2pFcVrNf57xvlCzjXD3hfgUK21TaCTQFtmekA' -d '{}' https://evm4rumeob.execute-api.eu-west-1.amazonaws.com/v0/table/0x9466df91658ba9312018438944250570df7dd2b9/pay

//get info
curl -X GET -H 'Content-Type: application/json'  https://evm4rumeob.execute-api.eu-west-1.amazonaws.com/v0/table/0x9466df91658ba9312018438944250570df7dd2b9/info

//timeout
curl -X POST -H 'Content-Type: application/json'  https://evm4rumeob.execute-api.eu-west-1.amazonaws.com/v0/table/0x9466df91658ba9312018438944250570df7dd2b9/timeout

//submit netting
curl -X POST -H 'Content-Type: application/json' -d '{"nettingSig": "1c9696afe6c23fbbf1bfc600b5730627cd8a150f04d1e7098a97f6c6f0454129504538ab611a8d8b322cea07383598bf9f432547dc2b799cad053f67901ba6161b"}' https://evm4rumeob.execute-api.eu-west-1.amazonaws.com/v0/table/0x060b4e6fe27ea634c016521a8509b7e717f3bede/hand/4/netting

//big blind
curl -X POST -H 'Content-Type: application/json' -H 'Authorization: eyJ0eXBlIjoiRVdUIiwiYWxnIjoiRVMyNTZrIn0.eyJiZXQiOlt7InVpbnQxMzYiOjB9LHsidWludDExMiI6MTAwMDB9XSwidiI6MH0.5xY9besS83HX1fMi0ZW94IjFXwxj4tCpy1vtG9fHfHp0yr5aZApu_vLHGyXhDlxQszLWrMS7mqL5PyFDWs7mpA' -d '{}' https://evm4rumeob.execute-api.eu-west-1.amazonaws.com/v0/table/0x9466df91658ba9312018438944250570df7dd2b9/pay

/0 blind

curl -X POST -H 'Content-Type: application/json' -H 'Authorization: eyJ0eXBlIjoiRVdUIiwiYWxnIjoiRVMyNTZrIn0.eyJiZXQiOlt7InVpbnQxMzYiOjB9LHsidWludDExMiI6MH1dLCJ2IjowfQ.ASyOvIiSCXBLCN0Ra-oCtIBZF0E-dN0vdlz5M5_VG0lH9c3ml-1A2tbLd12wQ26Sp6HkawyIOydIWBM_nZqKOw' -d '{}' https://evm4rumeob.execute-api.eu-west-1.amazonaws.com/v0/table/0x9466df91658ba9312018438944250570df7dd2b9/pay

/0 blind

curl -X POST -H 'Content-Type: application/json' -H 'Authorization: eyJ0eXBlIjoiRVdUIiwiYWxnIjoiRVMyNTZrIn0.eyJiZXQiOlt7InVpbnQxMzYiOjB9LHsidWludDExMiI6MH1dLCJ2IjoxfQ.w0Pu97N_BScg5aLKWgVmmyoSGt7ksGr6E3j-ju0wIyMCG67b2X8d1z0jiMwZfH5SNMUtNq2rpZxh2RiqvSGsAQ' -d '{}' https://evm4rumeob.execute-api.eu-west-1.amazonaws.com/v0/table/0x9466df91658ba9312018438944250570df7dd2b9/pay

/preflop
